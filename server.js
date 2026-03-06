const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store connected users and rooms
const users = {};
const rooms = {
  general: { name: 'ทั่วไป', users: new Set() },
  tech: { name: 'เทคโนโลยี', users: new Set() },
  random: { name: 'สุ่ม', users: new Set() }
};

// Store recent messages per room (last 50)
const roomMessages = {
  general: [],
  tech: [],
  random: []
};

function addMessage(room, msg) {
  if (!roomMessages[room]) roomMessages[room] = [];
  roomMessages[room].push(msg);
  if (roomMessages[room].length > 50) roomMessages[room].shift();
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // User joins with username
  socket.on('join', ({ username, room = 'general' }) => {
    username = username.trim().substring(0, 20);
    if (!username) return;

    socket.username = username;
    socket.currentRoom = room;
    users[socket.id] = { username, room };

    socket.join(room);
    if (rooms[room]) rooms[room].users.add(socket.id);

    // Send recent messages to new user
    socket.emit('room_history', roomMessages[room] || []);

    // Notify room
    const joinMsg = {
      type: 'system',
      text: `${username} เข้าร่วมห้องแชท`,
      timestamp: Date.now()
    };
    addMessage(room, joinMsg);
    io.to(room).emit('message', joinMsg);

    // Update user list
    io.to(room).emit('room_users', getRoomUsers(room));

    // Send available rooms info
    socket.emit('rooms_info', getRoomsInfo());
  });

  // Handle chat message
  socket.on('chat_message', ({ text, room }) => {
    if (!socket.username || !text || !text.trim()) return;
    text = text.trim().substring(0, 500);

    const msg = {
      type: 'chat',
      id: `${socket.id}-${Date.now()}`,
      username: socket.username,
      text,
      timestamp: Date.now()
    };

    addMessage(room, msg);
    io.to(room).emit('message', msg);
  });

  // Switch room
  socket.on('switch_room', (newRoom) => {
    if (!rooms[newRoom] || !socket.username) return;

    const oldRoom = socket.currentRoom;

    // Leave old room
    socket.leave(oldRoom);
    if (rooms[oldRoom]) rooms[oldRoom].users.delete(socket.id);

    const leaveMsg = {
      type: 'system',
      text: `${socket.username} ออกจากห้องแชท`,
      timestamp: Date.now()
    };
    addMessage(oldRoom, leaveMsg);
    io.to(oldRoom).emit('message', leaveMsg);
    io.to(oldRoom).emit('room_users', getRoomUsers(oldRoom));

    // Join new room
    socket.join(newRoom);
    socket.currentRoom = newRoom;
    users[socket.id].room = newRoom;
    if (rooms[newRoom]) rooms[newRoom].users.add(socket.id);

    // Send history
    socket.emit('room_history', roomMessages[newRoom] || []);

    const joinMsg = {
      type: 'system',
      text: `${socket.username} เข้าร่วมห้องแชท`,
      timestamp: Date.now()
    };
    addMessage(newRoom, joinMsg);
    io.to(newRoom).emit('message', joinMsg);
    io.to(newRoom).emit('room_users', getRoomUsers(newRoom));

    socket.emit('room_changed', newRoom);
    socket.emit('rooms_info', getRoomsInfo());
  });

  // Typing indicator
  socket.on('typing', ({ room, isTyping }) => {
    socket.to(room).emit('user_typing', {
      username: socket.username,
      isTyping
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (!socket.username) return;

    const room = socket.currentRoom;
    if (room) {
      if (rooms[room]) rooms[room].users.delete(socket.id);

      const leaveMsg = {
        type: 'system',
        text: `${socket.username} ออกจากห้องแชท`,
        timestamp: Date.now()
      };
      addMessage(room, leaveMsg);
      io.to(room).emit('message', leaveMsg);
      io.to(room).emit('room_users', getRoomUsers(room));
    }

    delete users[socket.id];
    console.log(`User disconnected: ${socket.username}`);
  });
});

function getRoomUsers(room) {
  if (!rooms[room]) return [];
  return Array.from(rooms[room].users)
    .filter(id => users[id])
    .map(id => users[id].username);
}

function getRoomsInfo() {
  return Object.entries(rooms).map(([id, room]) => ({
    id,
    name: room.name,
    count: room.users.size
  }));
}

server.listen(PORT, () => {
  console.log(`Chat server running at http://localhost:${PORT}`);
});
