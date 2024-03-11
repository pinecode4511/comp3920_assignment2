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
const e = require("express");

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
const mysqlConnection = mysql.createConnection({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DB,
});
mysqlConnection.connect((err) => {
  if (err) {
    console.error("Failed to connect to MySQL: ", err);
    throw err;
  }
  console.log("Connected to MySQL");
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
    if (error || results.length === 0) {
      res.send("Login failed. User not found.", error);
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

app.get("/rooms", async (req, res) => {
  const userId = req.session.user_id;

  // Query to get all rooms for the current user
  const query = `
      SELECT room.room_id, room.room_name, MAX(message.sent_datetime) as last_message_date
      FROM room_user
      JOIN room ON room_user.room_id = room.room_id
      LEFT JOIN message ON room_user.room_user_id = message.room_user_id
      WHERE room_user.user_id = ?
      GROUP BY room.room_id
      ORDER BY last_message_date DESC
    `;

    mysqlConnection.query(query, [userId], (error, results, fields) => {
      if (error) {
        console.error('Error executing query:', error);
        return;
      }
    
      // Log the entire results object
      console.log('Query Results:', results);
    
      // If you want to log a specific part of the results, like the first row:
      console.log('First Row:', results[0]);
      res.send(results);
    
    });
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
