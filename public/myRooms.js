document.addEventListener('DOMContentLoaded', function() {
  fetch('/myRooms')
    .then(response => {
      if (!response.ok) {
        throw new Error('Network response error: ' + response.statusText);
      }
      return response.json();
    })
    .then(data => {
      displayChatRooms(data);
    })
    .catch(error => {
      console.error('Error:', error);
    });
});

// Function to format the date
function formatDate(dateString) {
  const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' };
  return new Date(dateString).toLocaleDateString('en-US', options);
}

// Function to display the chat rooms
function displayChatRooms(rooms) {
  const container = document.getElementById('chat-rooms-list');
  container.innerHTML = ''; // Clear the container

  rooms.forEach(room => {
    const roomElement = document.createElement('div');
    roomElement.className = 'chat-room';
    roomElement.innerHTML = `
      <ul class="room-info">
        <li><strong>Room ID:</strong> ${room.room_id}</li>
        <li><strong>Last Message:</strong> ${formatDate(room.last_message_date)}</li>
        <li><strong>Unread Messages:</strong> <span class="unread-messages">${room.unread_message_count}</span></li>
      </ul>
    `;
    container.appendChild(roomElement);
  });
}
