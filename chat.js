const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: '*',
  credentials: true,
}));

app.get('/', (req, res) => {
  res.send('Video Call Signaling Server Running');
});

const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Store users: { userId: socketId }
const users = {};

io.on('connection', (socket) => {
  socket.on('join', ({ userId }) => {
    users[userId] = socket.id;
    socket.broadcast.emit('user-joined', { userId });
  });

  socket.on('call-user', ({ to, offer, from }) => {
    if (users[to]) {
      io.to(users[to]).emit('call-made', { offer, from });
    }
  });

  socket.on('make-answer', ({ to, answer, from }) => {
    if (users[to]) {
      io.to(users[to]).emit('answer-made', { answer, from });
    }
  });

  socket.on('ice-candidate', ({ to, candidate, from }) => {
    if (users[to]) {
      io.to(users[to]).emit('ice-candidate', { candidate, from });
    }
  });

  socket.on('disconnect', () => {
    for (const [userId, id] of Object.entries(users)) {
      if (id === socket.id) {
        delete users[userId];
        socket.broadcast.emit('user-left', { userId });
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Video Call Signaling Server running on port ${PORT}`);
});