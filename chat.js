const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Get the current domain for file URLs
const getCurrentDomain = () => {
  if (process.env.NODE_ENV === 'production') {
    return 'https://chat-backend-lfwv.onrender.com';
  }
  return 'http://192.168.1.3:5000';
};

const io = socketIo(server, {
  cors: {
    origin: [
      'http://localhost:5173', 
      'http://192.168.1.3:5173', 
      'http://localhost:3000',
      // Replace 'your-vercel-app.vercel.app' with your actual Vercel domain
      'https://your-vercel-app.vercel.app', 
      /^https:\/\/.*\.vercel\.app$/, // Allow any Vercel subdomain
      /^https:\/\/.*\.onrender\.com$/ // Allow any Render subdomain
    ],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Enhanced CORS configuration
app.use(cors({
  origin: [
    'http://localhost:5173', 
    'http://192.168.1.3:5173', 
    'http://localhost:3000',
    // Replace 'your-vercel-app.vercel.app' with your actual Vercel domain
    'https://your-vercel-app.vercel.app', 
    /^https:\/\/.*\.vercel\.app$/, // Allow any Vercel subdomain
    /^https:\/\/.*\.onrender\.com$/ // Allow any Render subdomain
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json());

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf', 'text/plain', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not supported'), false);
    }
  }
});

// Serve uploaded files with proper headers
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res, path) => {
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Access-Control-Allow-Origin', '*');
  }
}));

// File upload endpoint with better error handling
app.post('/upload', upload.array('files', 10), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'No files uploaded' 
      });
    }

    const uploadedFiles = req.files.map(file => ({
      id: Date.now().toString() + Math.random(),
      name: file.originalname,
      type: file.mimetype,
      size: file.size,
      url: getCurrentDomain() + '/uploads/' + file.filename,
      filename: file.filename
    }));
    
    console.log('Files uploaded successfully:', uploadedFiles.map(f => f.name));
    res.json({ success: true, files: uploadedFiles });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Upload failed' 
    });
  }
});

// Error handling middleware for multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        success: false, 
        error: 'File too large. Maximum size is 10MB.' 
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ 
        success: false, 
        error: 'Too many files. Maximum is 10 files.' 
      });
    }
  }
  
  if (error.message === 'File type not supported') {
    return res.status(400).json({ 
      success: false, 
      error: 'File type not supported' 
    });
  }
  
  console.error('Server error:', error);
  res.status(500).json({ 
    success: false, 
    error: 'Internal server error' 
  });
});

// Store connected users
const users = new Map();
// Store user ID to avatar color mapping
const userColors = new Map();
// Store user ID to socket ID mapping for WebRTC signaling
const userIdToSocketId = new Map();

// Generate random avatar color
const getRandomColor = () => {
  const colors = [
    'bg-indigo-500',
    'bg-green-500',
    'bg-yellow-500',
    'bg-red-500',
    'bg-purple-500',
    'bg-blue-500',
    'bg-pink-500',
    'bg-orange-500'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
};

const CHAT_HISTORY_FILE = path.join(__dirname, 'chats.json');
let chatHistory = [];

// Load chat history from file on server start
if (fs.existsSync(CHAT_HISTORY_FILE)) {
  try {
    const data = fs.readFileSync(CHAT_HISTORY_FILE, 'utf-8');
    chatHistory = JSON.parse(data);
  } catch (err) {
    console.error('Failed to load chat history:', err);
    chatHistory = [];
  }
}

// Helper to save chat history to file
function saveChatHistory() {
  try {
    fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify(chatHistory, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save chat history:', err);
  }
}

io.on('connection', (socket) => {
  console.log(`New client connected: ${socket.id}`);

  // Send chat history to the newly connected client
  socket.emit('chat_history', chatHistory);

  // --- Video Call Signaling Events ---

  // Start a group video call
  socket.on('start_call', ({ username, userId }) => {
    // Notify all other users of incoming call
    socket.broadcast.emit('incoming_call', {
      from: { username, userId, socketId: socket.id }
    });
  });

  // Accept call
  socket.on('accept_call', ({ username, userId }) => {
    // Notify all users (including initiator) that this user accepted
    io.emit('call_accepted', {
      username,
      userId,
      socketId: socket.id
    });
  });

  // Join existing call
  socket.on('join_call', ({ username, userId }) => {
    console.log('User joining call:', username, userId);
    
    // Notify all users that this user joined the existing call
    io.emit('user_joined_call', {
      username,
      userId,
      socketId: socket.id
    });
    
    // Also emit to the new joiner the list of existing call participants
    // This helps the frontend know who to create peer connections with
    const existingParticipants = Array.from(users.values()).filter(user => 
      user.id !== userId && user.isOnline
    );
    
    socket.emit('existing_call_participants', {
      participants: existingParticipants
    });
  });

  // Reject call
  socket.on('reject_call', ({ username, userId }) => {
    // Notify all users (including initiator) that this user rejected
    io.emit('call_rejected', {
      username,
      userId,
      socketId: socket.id
    });
  });

  // End call
  socket.on('end_call', ({ username, userId }) => {
    // Notify all users to end the call
    io.emit('call_ended', {
      username,
      userId,
      socketId: socket.id
    });
  });

  // WebRTC offer
  socket.on('webrtc_offer', (data) => {
    // data: { to, from, offer }
    console.log('WebRTC offer from', data.from, 'to', data.to);
    const targetSocketId = userIdToSocketId.get(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc_offer', data);
    }
  });

  // WebRTC answer
  socket.on('webrtc_answer', (data) => {
    // data: { to, from, answer }
    console.log('WebRTC answer from', data.from, 'to', data.to);
    const targetSocketId = userIdToSocketId.get(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc_answer', data);
    }
  });

  // WebRTC ICE candidate
  socket.on('webrtc_ice_candidate', (data) => {
    // data: { to, from, candidate }
    console.log('WebRTC ICE candidate from', data.from, 'to', data.to);
    const targetSocketId = userIdToSocketId.get(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc_ice_candidate', data);
    }
  });

  // Handle user joining
  socket.on('user_join', ({ username, id }) => {
    if (!username || typeof username !== 'string' || username.trim() === '') {
      socket.emit('error', { message: 'Invalid username' });
      return;
    }

    // Get or assign avatar color based on user ID
    let avatarColor = userColors.get(id);
    if (!avatarColor) {
      avatarColor = getRandomColor();
      userColors.set(id, avatarColor);
    }

    users.set(socket.id, {
      id: id || socket.id,
      username,
      avatarColor,
      isOnline: true
    });

    // Store user ID to socket ID mapping for WebRTC signaling
    userIdToSocketId.set(id || socket.id, socket.id);

    const eventId = `${socket.id}-${Date.now()}`; // Unique event ID

    // Broadcast to all other clients that a new user has joined
    socket.broadcast.emit('user_joined', {
      username,
      users: Array.from(users.values()),
      eventId
    });

    // Send current users list to the new user
    socket.emit('current_users', Array.from(users.values()));
  });

  // Handle new messages
  socket.on('send_message', ({ content, messageId, replyTo, attachments }) => {
    const user = users.get(socket.id);
    if (!user) {
      socket.emit('error', { message: 'User not found' });
      return;
    }
    
    // Allow sending if there's content OR attachments, not requiring both
    const hasContent = content && typeof content === 'string' && content.trim() !== '';
    const hasAttachments = attachments && Array.isArray(attachments) && attachments.length > 0;
    
    if (!hasContent && !hasAttachments) {
      socket.emit('error', { message: 'Message must contain text or attachments' });
      return;
    }

    const message = {
      id: messageId || Date.now().toString(),
      content: content || '',
      sender: {
        id: user.id,
        username: user.username,
        isOnline: true,
        avatarColor: user.avatarColor
      },
      timestamp: Date.now(),
      status: 'read',
      replyTo: replyTo,
      attachments: attachments || []
    };
    
    // Save message to chat history and persist to file
    chatHistory.push(message);
    saveChatHistory();
    
    console.log('Broadcasting message:', { 
      content: message.content, 
      attachments: message.attachments?.length,
      sender: user.username 
    });
    
    io.emit('new_message', message);
  });

  // Handle typing status
  socket.on('typing', (isTyping) => {
    const user = users.get(socket.id);
    if (user) {
      socket.broadcast.emit('user_typing', {
        id: user.id,
        username: user.username,
        isTyping
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      users.delete(socket.id);
      // Clean up user ID to socket ID mapping
      userIdToSocketId.delete(user.id);
      const eventId = `${socket.id}-${Date.now()}`; // Unique event ID
      io.emit('user_left', {
        username: user.username,
        users: Array.from(users.values()),
        eventId
      });
      console.log(`Client disconnected: ${socket.id}`);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Chat server running on port ${PORT}`);
  if (process.env.NODE_ENV === 'production') {
    console.log(`Production server running at https://chat-backend-lfwv.onrender.com`);
  } else {
    console.log(`Access the chat at http://localhost:${PORT}`);
    console.log(`For network access, use http://192.168.1.3:${PORT}`);
  }
});