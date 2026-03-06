const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const users = {};
const rooms = {
  general: { name: 'ทั่วไป', users: new Set() },
  tech:    { name: 'เทคโนโลยี', users: new Set() },
  random:  { name: 'สุ่ม', users: new Set() }
};
const roomMessages = { general: [], tech: [], random: [] };

function addMessage(room, msg) {
  if (!roomMessages[room]) roomMessages[room] = [];
  roomMessages[room].push(msg);
  if (roomMessages[room].length > 50) roomMessages[room].shift();
}

function randomSpawn() {
  return {
    x: 500 + Math.random() * 600,
    y: 300 + Math.random() * 400,
  };
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join', ({ username, room = 'general' }) => {
    username = username.trim().substring(0, 20);
    if (!username) return;

    const spawn = randomSpawn();
    socket.username = username;
    socket.currentRoom = room;
    users[socket.id] = { username, room, x: spawn.x, y: spawn.y, dir: 'down' };

    socket.join(room);
    if (rooms[room]) rooms[room].users.add(socket.id);

    socket.emit('room_history', roomMessages[room] || []);

    const positions = Object.entries(users)
      .filter(([id]) => id !== socket.id && users[id] && users[id].room === room)
      .map(([id, u]) => ({ id, username: u.username, x: u.x, y: u.y, dir: u.dir }));
    socket.emit('player_positions', positions);

    socket.to(room).emit('player_joined', {
      id: socket.id, username, x: spawn.x, y: spawn.y, dir: 'down'
    });

    const joinMsg = { type: 'system', text: `${username} เข้าร่วมห้องแชท`, timestamp: Date.now() };
    addMessage(room, joinMsg);
    io.to(room).emit('message', joinMsg);
    io.to(room).emit('room_users', getRoomUsers(room));
    socket.emit('rooms_info', getRoomsInfo());
  });

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
    io.to(room).emit('player_speech', { id: socket.id, text });
  });

  socket.on('player_move', ({ x, y, dir }) => {
    if (!socket.username) return;
    users[socket.id].x = x;
    users[socket.id].y = y;
    users[socket.id].dir = dir;
    socket.to(socket.currentRoom).emit('player_moved', { id: socket.id, x, y, dir });
  });

  socket.on('switch_room', (newRoom) => {
    if (!rooms[newRoom] || !socket.username) return;

    const oldRoom = socket.currentRoom;
    socket.leave(oldRoom);
    if (rooms[oldRoom]) rooms[oldRoom].users.delete(socket.id);
    socket.to(oldRoom).emit('player_left', { id: socket.id });

    const leaveMsg = { type: 'system', text: `${socket.username} ออกจากห้องแชท`, timestamp: Date.now() };
    addMessage(oldRoom, leaveMsg);
    io.to(oldRoom).emit('message', leaveMsg);
    io.to(oldRoom).emit('room_users', getRoomUsers(oldRoom));

    socket.join(newRoom);
    socket.currentRoom = newRoom;
    users[socket.id].room = newRoom;
    if (rooms[newRoom]) rooms[newRoom].users.add(socket.id);

    const spawn = randomSpawn();
    users[socket.id].x = spawn.x;
    users[socket.id].y = spawn.y;

    socket.emit('room_history', roomMessages[newRoom] || []);

    const positions = Object.entries(users)
      .filter(([id]) => id !== socket.id && users[id] && users[id].room === newRoom)
      .map(([id, u]) => ({ id, username: u.username, x: u.x, y: u.y, dir: u.dir }));
    socket.emit('player_positions', positions);

    socket.to(newRoom).emit('player_joined', {
      id: socket.id, username: socket.username,
      x: spawn.x, y: spawn.y, dir: 'down'
    });

    const joinMsg = { type: 'system', text: `${socket.username} เข้าร่วมห้องแชท`, timestamp: Date.now() };
    addMessage(newRoom, joinMsg);
    io.to(newRoom).emit('message', joinMsg);
    io.to(newRoom).emit('room_users', getRoomUsers(newRoom));
    socket.emit('room_changed', newRoom);
    socket.emit('rooms_info', getRoomsInfo());
  });

  socket.on('typing', ({ room, isTyping }) => {
    socket.to(room).emit('user_typing', { username: socket.username, isTyping });
    socket.to(room).emit('player_typing', { id: socket.id, isTyping });
  });

  socket.on('disconnect', () => {
    if (!socket.username) return;
    const room = socket.currentRoom;
    if (room) {
      if (rooms[room]) rooms[room].users.delete(socket.id);
      io.to(room).emit('player_left', { id: socket.id });

      const leaveMsg = { type: 'system', text: `${socket.username} ออกจากห้องแชท`, timestamp: Date.now() };
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
  return Array.from(rooms[room].users).filter(id => users[id]).map(id => users[id].username);
}

function getRoomsInfo() {
  return Object.entries(rooms).map(([id, room]) => ({
    id, name: room.name, count: room.users.size
  }));
}

server.listen(PORT, () => {
  console.log(`Chat server running at http://localhost:${PORT}`);
});
