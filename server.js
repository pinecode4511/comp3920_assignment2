const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const fs = require("fs");
const bcrypt = require("bcrypt");
const saltRounds = 10; // for bcrypt password hashing

require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;
const path = require("path");

// Set the view engine to ejs
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
// Configure session middleware to use MongoDB
app.use(
  session({
    secret: process.env.NODE_SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_CONNECTION_STR,
      crypto: {
        secret: process.env.MONGO_SESSION_SECRET,
      },
    }),
    cookie: {
      secure: !true, // Set to true in production with HTTPS
      maxAge: 3600000, // 1 hour in milliseconds
    },
  })
);

app.get("/", (req, res) => {
  console.log(`req.session.username:${req.session.username}`);
  if (req.session.username) {
    res.sendFile(path.join(__dirname, "public", "member.html"));
  } else {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  }
});

app.get("/member", (req, res) => {
  if (req.session.username) {
    const filePath = path.join(__dirname, "public", "member.html");
    let htmlContent = fs.readFileSync(filePath, "utf8");

    // Escape the username to prevent HTML/JS injection
    const safeUsername = escapeHtml(req.session.username);
    htmlContent = htmlContent.replace("<!--USERNAME-->", safeUsername);
    res.send(htmlContent);
  } else {
    res.redirect("/");
  }
});

// Signup Page
app.get("/signup", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "signup.html"));
});

// Login Page
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// MySQL connection (secure version)
const mysqlConnection = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DB,
  multipleStatements: false,
  namedPlaceholders: true,
});

// Signup Handler with bcrypt hashing
app.post("/signup", (req, res) => {
  const { username, password } = req.body;
  bcrypt.hash(password, saltRounds, (err, hash) => {
    if (err) {
      res.send("Error hashing password.");
    } else {
      const query = "INSERT INTO user (username, password) VALUES (?, ?)";
      mysqlConnection.query(query, [username, hash], (error) => {
        if (error) {
          console.error(error);
          res.send("Error in sign-up.");
        } else res.send('Sign-up successful. <a href="/">Go to home</a>');
      });
    }
  });
});

// Login Handler with bcrypt password verification
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const query = "SELECT * FROM user WHERE username = ?";
  mysqlConnection.query(query, [username], (error, results) => {
    if (error) {
      res.send(`Error: ${error}`);
    } else if (results.length > 1) {
      res.send("Error: Multiple users found.");
    } else if (results.length === 0) {
      res.send("Username not found.");
    } else {
      bcrypt.compare(password, results[0].password, (err, result) => {
        if (result) {
          req.session.username = username;
          req.session.user_id = results[0].user_id;
          console.log(`Log in successful. Username: ${username}`);
          res.redirect("/member");
        } else {
          console.log(err);
          res.send("Login failed. Incorrect password.");
        }
      });
    }
  });
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.get("/myRooms", async (req, res) => {
  if (!req.session.user_id) {
    res.status(401).send("Unauthorized");
    return;
  } else {
    const userId = req.session.user_id;
    // Query to get all rooms for the current user
    const query = `
    SELECT ru.room_id, lmd.last_message_date, umc.unread_message_count
    FROM room_user ru
    JOIN (
	    SELECT room_user.room_id, MAX(message.sent_datetime) AS last_message_date
	    FROM room_user
	    LEFT JOIN message ON room_user.room_user_id = message.room_user_id
	    GROUP BY room_user.room_id
    ) lmd ON lmd.room_id = ru.room_id
    JOIN (
	    SELECT ru.user_id, ru.room_id,COUNT(m.message_id) AS unread_message_count
	    FROM room_user ru
	    LEFT JOIN message m ON ru.room_user_id = m.room_user_id AND m.message_id > ru.last_read_msg_id
	    GROUP BY ru.user_id, ru.room_id
    ) umc ON umc.room_id = ru.room_id
    WHERE ru.user_id = ?
    GROUP BY ru.room_id;
      `;

    mysqlConnection.query(query, [userId], (error, results, fields) => {
      if (error) {
        console.error("Error executing query:", error);
        return;
      }
      res.render("myRooms", { rooms: results });
    });
  }
});

app.get("/rooms/:roomId", async (req, res) => {
  if (!req.session.user_id) {
    res.status(401).send("Unauthorized: User not logged in.");
    return;
  }

  const userId = req.session.user_id;
  const roomId = req.params.roomId;

  try {
    const [r_u_id] = await mysqlConnection
      .promise()
      .query(
        "SELECT room_user_id FROM room_user WHERE room_id = ? AND user_id = ?",
        [roomId, userId]
      );

    // If the user is not a member of the room, send an unauthorized message
    if (r_u_id.length === 0) {
      res.status(401).send("Unauthorized: You are not a member of this room.");
      return;
    }

    const [latestMessageId] = await mysqlConnection.promise().query(
      `
      SELECT MAX(message_id) AS max_msg_id FROM message m
      JOIN room_user ru ON ru.room_user_id = m.room_user_id
      WHERE ru.room_id = ?`,
      [roomId]
    );
    console.log(
      `latestMessage:${latestMessageId[0].max_msg_id}, r_u_id:${r_u_id[0].room_user_id}`
    );

    if (latestMessageId) {
      await mysqlConnection
        .promise()
        .query(
          "UPDATE room_user SET last_read_msg_id = ? WHERE room_user_id = ?",
          [latestMessageId[0].max_msg_id, r_u_id[0].room_user_id]
        );
    } else {
      console.error("Cannot find latestMessageId");
    }

    // Query to fetch messages from the database for the room
    const messagesQuery = `
      SELECT m.message_content, u.username, m.sent_datetime 
      FROM message m
      JOIN room_user ru ON ru.room_user_id = m.room_user_id
      JOIN user u ON u.user_id = ru.user_id
      WHERE ru.room_id = ?
      ORDER BY m.sent_datetime ASC;
      `;

    const [messages] = await mysqlConnection
      .promise()
      .query(messagesQuery, [roomId]);

    // Render the template for displaying messages
    res.render("roomMessages", { roomId: roomId, messages: messages });
  } catch (error) {
    console.error("Error executing query:", error);
    res.status(500).send("An error occurred while fetching messages.");
  }
});

app.post("/rooms/:roomId/message", async (req, res) => {
  if (!req.session.user_id) {
    return res.status(401).send("Unauthorized: User not logged in.");
  }

  const userId = req.session.user_id;
  const roomId = req.params.roomId;
  const { message } = req.body;

  // Find the room_user_id for the current user_id and room_id combination
  const findRoomUserIdQuery = `
      SELECT room_user_id
      FROM room_user
      WHERE user_id = ? AND room_id = ?
      LIMIT 1;
  `;

  try {
    const [roomUserResult] = await mysqlConnection
      .promise()
      .query(findRoomUserIdQuery, [userId, roomId]);

    if (roomUserResult.length === 0) {
      return res
        .status(401)
        .send(
          "Unauthorized: You are not a member of this room or the room does not exist."
        );
    }

    const roomUserId = roomUserResult[0].room_user_id;

    // Insert the new message into the database using the found room_user_id
    const insertMessageQuery = `
          INSERT INTO message (room_user_id, message_content, sent_datetime)
          VALUES (?, ?, NOW());
      `;
    await mysqlConnection
      .promise()
      .query(insertMessageQuery, [roomUserId, message]);

    // Redirect back to the room messages page
    res.redirect("/rooms/" + roomId);
  } catch (error) {
    console.error("Error executing query:", error);
    res.status(500).send("An error occurred while posting your message.");
  }
});

app.get("*", (req, res) => {
  res.status(404);
  res.send("Page not found - 404");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

//function for converting string with html symbol to a safe string
function escapeHtml(unsafeString) {
  return unsafeString
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
