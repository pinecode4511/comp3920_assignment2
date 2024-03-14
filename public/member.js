console.log('member.js loaded');
// document.addEventListener('DOMContentLoaded', () => {
//   const images = ['/images/img1.jpeg', '/images/img2.jpeg', '/images/img3.jpeg'];
//   document.getElementById('randomImage').src = images[Math.floor(Math.random() * images.length)];
// });

function logout() {
  window.location.href = '/logout';
}

function getRooms() {
  window.location.href = '/myRooms';
} 
