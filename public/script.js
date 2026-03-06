const socket = io();

// ── State ──
let myUsername = '';
let currentRoom = 'general';
let typingTimer = null;
let isTyping = false;
let typingUsers = new Set();
let lastMsgUser = null;
let lastMsgTime = 0;
const GROUP_THRESHOLD = 60000; // 60 sec

// ── DOM refs ──
const loginScreen   = document.getElementById('login-screen');
const chatScreen    = document.getElementById('chat-screen');
const loginForm     = document.getElementById('login-form');
const usernameInput = document.getElementById('username-input');
const messagesArea  = document.getElementById('messages-area');
const messageInput  = document.getElementById('message-input');
const sendBtn       = document.getElementById('send-btn');
const charCount     = document.getElementById('char-count');
const typingIndicator = document.getElementById('typing-indicator');
const typingText    = document.getElementById('typing-text');
const userList      = document.getElementById('user-list');
const userCount     = document.getElementById('user-count');
const headerUserCount = document.getElementById('header-user-count');
const roomList      = document.getElementById('room-list');
const currentRoomName = document.getElementById('current-room-name');
const myAvatar      = document.getElementById('my-avatar');
const myName        = document.getElementById('my-name');
const menuBtn       = document.getElementById('menu-btn');
const sidebar       = document.getElementById('sidebar');
const sidebarClose  = document.getElementById('sidebar-close');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const logoutBtn     = document.getElementById('logout-btn');

// Room name map
const roomNames = { general: 'ทั่วไป', tech: 'เทคโนโลยี', random: 'สุ่ม' };

// ── Login ──
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const username = usernameInput.value.trim();
  if (!username) {
    usernameInput.focus();
    return;
  }
  const roomInput = loginForm.querySelector('input[name="room"]:checked');
  const room = roomInput ? roomInput.value : 'general';

  myUsername = username;
  currentRoom = room;

  socket.emit('join', { username, room });

  loginScreen.classList.remove('active');
  chatScreen.classList.add('active');

  myAvatar.textContent = username.charAt(0).toUpperCase();
  myName.textContent = username;

  setTimeout(() => messageInput.focus(), 200);
});

// Room option UI
document.querySelectorAll('.room-option').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.room-option').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
  });
});

// ── Messages ──
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

function getAvatarColor(name) {
  const colors = [
    ['#667eea', '#764ba2'],
    ['#f093fb', '#f5576c'],
    ['#4facfe', '#00f2fe'],
    ['#43e97b', '#38f9d7'],
    ['#fa709a', '#fee140'],
    ['#a18cd1', '#fbc2eb'],
    ['#ffecd2', '#fcb69f'],
    ['#96fbc4', '#f9f586'],
  ];
  let hash = 0;
  for (let c of name) hash = (hash + c.charCodeAt(0)) & 0xff;
  const [c1, c2] = colors[hash % colors.length];
  return `linear-gradient(135deg, ${c1}, ${c2})`;
}

function renderMessage(msg, isHistory = false) {
  if (msg.type === 'system') {
    const div = document.createElement('div');
    div.className = 'msg-system';
    div.innerHTML = `<span class="msg-system-text">${escapeHtml(msg.text)}</span>`;
    messagesArea.appendChild(div);
    lastMsgUser = null;
    lastMsgTime = 0;
    return;
  }

  const isMine = msg.username === myUsername;
  const now = msg.timestamp;
  const grouped = (msg.username === lastMsgUser) && ((now - lastMsgTime) < GROUP_THRESHOLD);

  const div = document.createElement('div');
  div.className = `msg ${isMine ? 'mine' : 'theirs'}${grouped ? ' grouped' : ''}`;
  div.dataset.id = msg.id || '';

  const avatarStyle = isMine ? '' : `style="background:${getAvatarColor(msg.username)}"`;

  if (!isMine) {
    div.innerHTML = `
      <div class="msg-header">
        <div class="avatar" ${avatarStyle}>${escapeHtml(msg.username.charAt(0).toUpperCase())}</div>
        <span class="msg-username">${escapeHtml(msg.username)}</span>
        <span class="msg-time">${formatTime(now)}</span>
      </div>
      <div class="msg-bubble">${escapeHtml(msg.text)}</div>
    `;
  } else {
    div.innerHTML = `
      <div class="msg-header">
        <span class="msg-time">${formatTime(now)}</span>
        <span class="msg-username">คุณ</span>
      </div>
      <div class="msg-bubble">${escapeHtml(msg.text)}</div>
    `;
  }

  lastMsgUser = msg.username;
  lastMsgTime = now;

  messagesArea.appendChild(div);
}

function scrollToBottom(force = false) {
  const el = messagesArea;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  if (force || nearBottom) {
    el.scrollTop = el.scrollHeight;
  }
}

function clearMessages() {
  messagesArea.innerHTML = `
    <div class="welcome-msg">
      <div class="welcome-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
        </svg>
      </div>
      <p>ยินดีต้อนรับสู่ห้องแชท เริ่มต้นการสนทนาได้เลย!</p>
    </div>
  `;
  lastMsgUser = null;
  lastMsgTime = 0;
}

// ── Socket events ──
socket.on('message', (msg) => {
  renderMessage(msg);
  scrollToBottom();
});

socket.on('room_history', (messages) => {
  clearMessages();
  messages.forEach(m => renderMessage(m, true));
  scrollToBottom(true);
});

socket.on('room_users', (users) => {
  userCount.textContent = users.length;
  headerUserCount.textContent = users.length;
  userList.innerHTML = users.map(u => `
    <div class="user-item ${u === myUsername ? 'me' : ''}">
      <div class="avatar" style="background:${getAvatarColor(u)};width:28px;height:28px;font-size:12px">
        ${escapeHtml(u.charAt(0).toUpperCase())}
      </div>
      <span>${escapeHtml(u)}${u === myUsername ? ' (คุณ)' : ''}</span>
    </div>
  `).join('');
});

socket.on('rooms_info', (rooms) => {
  roomList.innerHTML = rooms.map(r => `
    <div class="room-item ${r.id === currentRoom ? 'active' : ''}" data-room="${r.id}">
      <span class="room-item-hash">#</span>
      <span>${escapeHtml(r.name)}</span>
      <span class="room-item-count">${r.count}</span>
    </div>
  `).join('');

  document.querySelectorAll('.room-item').forEach(item => {
    item.addEventListener('click', () => {
      const room = item.dataset.room;
      if (room !== currentRoom) switchRoom(room);
      closeSidebar();
    });
  });
});

socket.on('room_changed', (room) => {
  currentRoom = room;
  currentRoomName.textContent = roomNames[room] || room;
  typingUsers.clear();
  updateTypingDisplay();
});

socket.on('user_typing', ({ username, isTyping }) => {
  if (username === myUsername) return;
  if (isTyping) {
    typingUsers.add(username);
  } else {
    typingUsers.delete(username);
  }
  updateTypingDisplay();
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
});

socket.on('connect', () => {
  // If already in chat (reconnect), re-join
  if (myUsername && chatScreen.classList.contains('active')) {
    socket.emit('join', { username: myUsername, room: currentRoom });
  }
});

// ── Typing ──
function updateTypingDisplay() {
  if (typingUsers.size === 0) {
    typingIndicator.style.display = 'none';
  } else {
    typingIndicator.style.display = 'flex';
    const names = Array.from(typingUsers).join(', ');
    typingText.textContent = typingUsers.size === 1
      ? `${names} กำลังพิมพ์...`
      : `${names} กำลังพิมพ์...`;
  }
}

messageInput.addEventListener('input', () => {
  const val = messageInput.value;
  charCount.textContent = `${val.length}/500`;
  sendBtn.disabled = !val.trim();

  // Auto-resize
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 140) + 'px';

  // Typing events
  if (!isTyping) {
    isTyping = true;
    socket.emit('typing', { room: currentRoom, isTyping: true });
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    isTyping = false;
    socket.emit('typing', { room: currentRoom, isTyping: false });
  }, 2000);
});

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;

  socket.emit('chat_message', { text, room: currentRoom });

  messageInput.value = '';
  messageInput.style.height = 'auto';
  charCount.textContent = '0/500';
  sendBtn.disabled = true;

  // Stop typing
  clearTimeout(typingTimer);
  if (isTyping) {
    isTyping = false;
    socket.emit('typing', { room: currentRoom, isTyping: false });
  }

  messageInput.focus();
}

function switchRoom(room) {
  socket.emit('switch_room', room);
}

// ── Sidebar toggle ──
menuBtn.addEventListener('click', () => {
  sidebar.classList.add('open');
  sidebarOverlay.classList.add('open');
});

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('open');
}

sidebarClose.addEventListener('click', closeSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);

// ── Logout ──
logoutBtn.addEventListener('click', () => {
  chatScreen.classList.remove('active');
  loginScreen.classList.add('active');
  clearMessages();
  myUsername = '';
  currentRoom = 'general';
  socket.disconnect();
  socket.connect();
  usernameInput.value = '';
  usernameInput.focus();
});

// ── Helpers ──
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
