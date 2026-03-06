const socket = io();

// ── State ──
let myUsername = '';
let currentRoom = 'general';
let typingTimer = null;
let isTyping = false;
let typingUsers = new Set();
let lastMsgUser = null;
let lastMsgTime = 0;
const GROUP_THRESHOLD = 60000;
let chatPanelOpen = false;
let unreadCount = 0;

// ── DOM refs ──
const loginScreen    = document.getElementById('login-screen');
const chatScreen     = document.getElementById('chat-screen');
const loginForm      = document.getElementById('login-form');
const usernameInput  = document.getElementById('username-input');
const messagesArea   = document.getElementById('messages-area');
const messageInput   = document.getElementById('message-input');
const sendBtn        = document.getElementById('send-btn');
const charCount      = document.getElementById('char-count');
const typingIndicator = document.getElementById('typing-indicator');
const typingText     = document.getElementById('typing-text');
const userList       = document.getElementById('user-list');
const userCount      = document.getElementById('user-count');
const headerUserCount = document.getElementById('header-user-count');
const roomList       = document.getElementById('room-list');
const currentRoomName = document.getElementById('current-room-name');
const myAvatar       = document.getElementById('my-avatar');
const myName         = document.getElementById('my-name');
const menuBtn        = document.getElementById('menu-btn');
const sidebar        = document.getElementById('sidebar');
const sidebarClose   = document.getElementById('sidebar-close');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const logoutBtn      = document.getElementById('logout-btn');
const chatToggleBtn  = document.getElementById('chat-toggle-btn');
const chatPanel      = document.getElementById('chat-panel');
const chatBadge      = document.getElementById('chat-badge');

const roomNames = { general: 'ทั่วไป', tech: 'เทคโนโลยี', random: 'สุ่ม' };

// ═══════════════════════════════════════════
// GAME ENGINE
// ═══════════════════════════════════════════

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const TILE = 32;
const MAP_W = 50;
const MAP_H = 36;
const CHAR_SPEED = 2.8;
const MOVE_THROTTLE = 100;
const SPEECH_DURATION = 4500;
const CHAR_H = 48; // character height in world pixels

// Game state
const game = {
  players: new Map(),   // socketId -> player object
  myId: null,
  map: null,
  keys: new Set(),
  lastMoveEmit: 0,
  tick: 0,
};

// ── Seeded RNG ──
function seededRng(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
    h = h >>> 0;
  }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    h = h >>> 0;
    return h / 0xffffffff;
  };
}

// ── Map generation ──
// 0=grass, 1=dark grass, 2=tree, 3=flower, 4=water, 5=path
function generateMap(room) {
  const rng = seededRng(room + '_map');
  const map = [];
  for (let y = 0; y < MAP_H; y++) {
    map[y] = [];
    for (let x = 0; x < MAP_W; x++) {
      if (x <= 1 || y <= 1 || x >= MAP_W - 2 || y >= MAP_H - 2) {
        map[y][x] = 2;
      } else {
        const r = rng();
        if      (r < 0.12) map[y][x] = 2;
        else if (r < 0.18) map[y][x] = 3;
        else if (r < 0.30) map[y][x] = 1;
        else               map[y][x] = 0;
      }
    }
  }
  // Cross path
  const midY = Math.floor(MAP_H / 2);
  const midX = Math.floor(MAP_W / 2);
  for (let x = 2; x < MAP_W - 2; x++) {
    map[midY][x] = 5; map[midY + 1][x] = 5;
  }
  for (let y = 2; y < MAP_H - 2; y++) {
    map[y][midX] = 5; map[y][midX + 1] = 5;
  }
  // Small pond
  const pRng = seededRng(room + '_pond');
  const px = 6 + Math.floor(pRng() * 10);
  const py = 4 + Math.floor(pRng() * 8);
  for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 4; dx++) map[py + dy][px + dx] = 4;
  return map;
}

function isSolid(x, y) {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (!game.map || !game.map[ty] || game.map[ty][tx] === undefined) return true;
  return game.map[ty][tx] === 2;
}

// ── Tile drawing ──
function drawTile(c, type, px, py) {
  const T = TILE;

  c.fillStyle = type === 1 ? '#3d9910' : '#4aad18';
  c.fillRect(px, py, T, T);

  if (type === 2) {
    c.fillStyle = 'rgba(0,0,0,0.18)';
    c.fillRect(px + 5, py + 22, T - 6, 10);
    c.fillStyle = '#6b3a10';
    c.fillRect(px + 12, py + 20, 8, 12);
    c.fillStyle = '#185a08';
    c.fillRect(px + 3, py + 2, T - 6, 22);
    c.fillStyle = '#228010';
    c.fillRect(px + 6, py + 4, T - 12, 16);
    c.fillStyle = '#32a018';
    c.fillRect(px + 9, py + 6, 12, 9);
    c.fillStyle = '#48c028';
    c.fillRect(px + 11, py + 7, 6, 5);
  } else if (type === 3) {
    const fc = ['#ff6b6b','#ffd93d','#ff9ff3','#74ebd5','#a29bfe'][(px * 3 + py * 7) % 5];
    c.fillStyle = fc;
    c.fillRect(px + 4, py + 7, 4, 4);
    c.fillRect(px + 18, py + 15, 4, 4);
    c.fillRect(px + 24, py + 8, 3, 3);
    c.fillStyle = '#fff9c4';
    c.fillRect(px + 5, py + 8, 2, 2);
    c.fillRect(px + 19, py + 16, 2, 2);
  } else if (type === 4) {
    // Water — animated, drawn live each frame
    c.fillStyle = '#2a8bd1';
    c.fillRect(px, py, T, T);
    const wave = Math.floor(game.tick / 25) % 2;
    c.fillStyle = 'rgba(255,255,255,0.22)';
    c.fillRect(px + wave * 6, py + 10, 14, 2);
    c.fillRect(px + 16 - wave * 6, py + 22, 10, 2);
    c.fillStyle = 'rgba(255,255,255,0.1)';
    c.fillRect(px + 2, py + 16, 20, 1);
  } else if (type === 5) {
    c.fillStyle = '#c4a050';
    c.fillRect(px, py, T, T);
    c.fillStyle = '#b09040';
    c.fillRect(px + 1, py + 1, T - 2, 2);
    c.fillRect(px + 1, py + T - 3, T - 2, 2);
    // Pre-cached pebble positions stored on tile call (static)
    const pr = seededRng(`${Math.floor(px/T)},${Math.floor(py/T)}`);
    c.fillStyle = '#9a7a30';
    for (let i = 0; i < 3; i++) {
      c.fillRect(px + 2 + Math.floor(pr() * 28), py + 5 + Math.floor(pr() * 22), 2, 2);
    }
  } else {
    c.fillStyle = 'rgba(0,0,0,0.04)';
    c.fillRect(px, py + T - 4, T, 4);
  }
}

// Pre-render static tiles (everything except water) to offscreen canvas
let mapCanvas = null;
function prerenderMap() {
  mapCanvas = document.createElement('canvas');
  mapCanvas.width = MAP_W * TILE;
  mapCanvas.height = MAP_H * TILE;
  const mc = mapCanvas.getContext('2d');
  mc.imageSmoothingEnabled = false;
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const type = game.map[ty][tx];
      if (type !== 4) {
        drawTile(mc, type, tx * TILE, ty * TILE);
      } else {
        // water placeholder (drawn live each frame)
        mc.fillStyle = '#2a8bd1';
        mc.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
    }
  }
}

// ── Character color ──
function charColor(username) {
  const palette = ['#e74c3c','#e67e22','#f39c12','#27ae60','#16a085','#2980b9','#8e44ad','#e91e63','#ff5722','#00bcd4','#8bc34a','#ff9800'];
  let h = 0;
  for (let c of username) h = (h * 31 + c.charCodeAt(0)) & 0xff;
  return palette[h % palette.length];
}

// ── Draw 8-bit character ──
function drawCharacter(cx, cy, username, dir, frame, isMe) {
  const s = 3;
  const color = charColor(username);
  const darkColor = shadeColor(color, -35);

  ctx.save();
  ctx.translate(Math.round(cx), Math.round(cy));
  if (dir === 'left') ctx.scale(-1, 1);

  const walkFrame = Math.floor(frame) % 4;
  const step = walkFrame === 1 || walkFrame === 3 ? s : 0;
  const legL = walkFrame === 1 ? s * 2 : 0;
  const legR = walkFrame === 3 ? s * 2 : 0;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 10, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Shoes
  ctx.fillStyle = '#111';
  ctx.fillRect(-4 * s, -1 * s + legL, 3 * s, s);
  ctx.fillRect(1 * s, -1 * s + legR, 3 * s, s);

  // Legs
  ctx.fillStyle = '#1e3a78';
  ctx.fillRect(-4 * s, -4 * s, 3 * s, 3 * s + legL);
  ctx.fillRect(1 * s, -4 * s, 3 * s, 3 * s + legR);
  ctx.fillStyle = '#2b5296';
  ctx.fillRect(-4 * s, -5 * s, 3 * s, s);
  ctx.fillRect(1 * s, -5 * s, 3 * s, s);

  // Body
  ctx.fillStyle = color;
  ctx.fillRect(-4 * s, -11 * s, 8 * s, 7 * s);
  ctx.fillStyle = darkColor;
  ctx.fillRect(-4 * s, -11 * s, 8 * s, s); // collar
  ctx.fillRect(-4 * s, -5 * s, 8 * s, s);  // belt

  // Arms (swing with walk)
  const armSwing = step;
  ctx.fillStyle = color;
  ctx.fillRect(-6 * s, -10 * s + armSwing, 2 * s, 4 * s);
  ctx.fillRect(4 * s, -10 * s - armSwing + s, 2 * s, 4 * s);

  // Skin (hands & neck)
  ctx.fillStyle = '#ffcc99';
  ctx.fillRect(-6 * s, -6 * s + armSwing, 2 * s, s);
  ctx.fillRect(4 * s, -6 * s - armSwing + s, 2 * s, s);
  ctx.fillRect(-2 * s, -12 * s, 4 * s, 2 * s);

  // Head
  ctx.fillStyle = '#ffcc99';
  ctx.fillRect(-4 * s, -18 * s, 8 * s, 7 * s);

  // Hair
  ctx.fillStyle = '#3a2200';
  ctx.fillRect(-4 * s, -18 * s, 8 * s, 2 * s);
  ctx.fillRect(-5 * s, -17 * s, 2 * s, 3 * s);
  ctx.fillRect(3 * s, -17 * s, 2 * s, 2 * s);

  // Eyes
  if (dir !== 'up') {
    ctx.fillStyle = '#222';
    ctx.fillRect(-3 * s, -14 * s, s, s);
    ctx.fillRect(2 * s, -14 * s, s, s);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-3 * s + 1, -14 * s, 1, 1);
    ctx.fillRect(2 * s + 1, -14 * s, 1, 1);
  } else {
    ctx.fillStyle = '#222';
    ctx.fillRect(-2 * s, -14 * s, 4 * s, s);
  }

  // Name tag
  ctx.restore();
  ctx.save();
  ctx.translate(Math.round(cx), Math.round(cy));

  ctx.font = 'bold 11px "Courier New", monospace';
  ctx.textAlign = 'center';
  const label = isMe ? `★ ${username}` : username;
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(-tw / 2 - 4, -CHAR_H - 16, tw + 8, 15);
  ctx.fillStyle = isMe ? '#ffd700' : '#e8eaf6';
  ctx.fillText(label, 0, -CHAR_H - 4);
  ctx.textAlign = 'left';
  ctx.restore();
}

function shadeColor(hex, pct) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + pct));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + pct));
  const b = Math.max(0, Math.min(255, (num & 0xff) + pct));
  return `rgb(${r},${g},${b})`;
}

// ── Draw speech bubble ──
function drawSpeechBubble(cx, cy, text, isTyping) {
  const FONT_SZ = 12;
  const PAD = 7;
  const LINE_H = 15;
  const MAX_W = 180;

  ctx.font = `${FONT_SZ}px "Courier New", monospace`;
  ctx.textAlign = 'left';

  let lines;
  if (isTyping) {
    const dots = '.'.repeat((Math.floor(Date.now() / 350) % 3) + 1);
    lines = [dots + '  '];
  } else {
    const words = text.split(' ');
    lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > MAX_W - PAD * 2) {
        if (line) lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    if (lines.length > 3) lines.length = 3;
  }

  const bw = Math.min(MAX_W, Math.max(...lines.map(l => ctx.measureText(l).width)) + PAD * 2);
  const bh = lines.length * LINE_H + PAD * 2;
  const bx = cx - bw / 2;
  const by = cy - CHAR_H - bh - 14;
  const r = 6;

  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1.5;

  // Bubble path with tail
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + bw - r, by);
  ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
  ctx.lineTo(bx + bw, by + bh - r);
  ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
  ctx.lineTo(cx + 7, by + bh);
  ctx.lineTo(cx, by + bh + 10);
  ctx.lineTo(cx - 7, by + bh);
  ctx.lineTo(bx + r, by + bh);
  ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
  ctx.lineTo(bx, by + r);
  ctx.quadraticCurveTo(bx, by, bx + r, by);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#111';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + PAD, by + PAD + i * LINE_H));
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
}

// ── Camera ──
function getCamera() {
  const me = game.players.get(game.myId);
  if (!me) return { x: 0, y: 0 };
  const vw = canvas.width;
  const vh = canvas.height;
  const camX = Math.max(0, Math.min(MAP_W * TILE - vw, me.x - vw / 2));
  const camY = Math.max(0, Math.min(MAP_H * TILE - vh, me.y - vh / 2));
  return { x: camX, y: camY };
}

// ── Game loop ──
function gameLoop() {
  game.tick++;

  const me = game.players.get(game.myId);
  if (me) updateMovement(me);

  renderWorld();
  requestAnimationFrame(gameLoop);
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  ctx.imageSmoothingEnabled = false;
}

function renderWorld() {
  if (!game.map || !mapCanvas) return;

  const cam = getCamera();
  const vw = canvas.width;
  const vh = canvas.height;

  // Draw pre-rendered static map in one call
  ctx.drawImage(mapCanvas, Math.round(-cam.x), Math.round(-cam.y));

  // Draw only animated water tiles on top
  const tx0 = Math.max(0, Math.floor(cam.x / TILE));
  const tx1 = Math.min(MAP_W - 1, Math.ceil((cam.x + vw) / TILE));
  const ty0 = Math.max(0, Math.floor(cam.y / TILE));
  const ty1 = Math.min(MAP_H - 1, Math.ceil((cam.y + vh) / TILE));
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (game.map[ty][tx] === 4) {
        drawTile(ctx, 4, tx * TILE - cam.x, ty * TILE - cam.y);
      }
    }
  }

  // Sort players by Y for depth
  const players = [...game.players.values()].sort((a, b) => a.y - b.y);
  const now = Date.now();

  for (const p of players) {
    const sx = p.x - cam.x;
    const sy = p.y - cam.y;
    if (sx < -80 || sx > vw + 80 || sy < -100 || sy > vh + 20) continue;

    drawCharacter(sx, sy, p.username, p.dir, p.frame, p.id === game.myId);

    if (p.speech) {
      const elapsed = now - p.speech.ts;
      if (elapsed < SPEECH_DURATION) {
        ctx.globalAlpha = elapsed > SPEECH_DURATION - 600
          ? 1 - (elapsed - (SPEECH_DURATION - 600)) / 600 : 1;
        drawSpeechBubble(sx, sy, p.speech.text, false);
        ctx.globalAlpha = 1;
      } else {
        p.speech = null;
      }
    } else if (p.typing) {
      drawSpeechBubble(sx, sy, '...', true);
    }
  }
}

// ── Movement ──
function updateMovement(me) {
  let dx = 0, dy = 0;

  if (game.keys.has('ArrowLeft')  || game.keys.has('KeyA')) dx -= 1;
  if (game.keys.has('ArrowRight') || game.keys.has('KeyD')) dx += 1;
  if (game.keys.has('ArrowUp')    || game.keys.has('KeyW')) dy -= 1;
  if (game.keys.has('ArrowDown')  || game.keys.has('KeyS')) dy += 1;

  if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }

  if (dx !== 0 || dy !== 0) {
    if (dx < 0) me.dir = 'left';
    else if (dx > 0) me.dir = 'right';
    else if (dy < 0) me.dir = 'up';
    else me.dir = 'down';

    const speed = CHAR_SPEED;
    const nx = me.x + dx * speed;
    const ny = me.y + dy * speed;
    const hw = 10; // half-width for collision
    const foot = 4; // foot offset from bottom

    if (!isSolid(nx - hw, me.y - foot) && !isSolid(nx + hw, me.y - foot)) {
      me.x = Math.max(TILE * 2 + hw, Math.min(MAP_W * TILE - TILE * 2 - hw, nx));
    }
    if (!isSolid(me.x - hw, ny - foot) && !isSolid(me.x + hw, ny - foot)) {
      me.y = Math.max(TILE * 2 + foot, Math.min(MAP_H * TILE - TILE * 2, ny));
    }

    me.frame = (me.frame + 0.2) % 4;

    const now = Date.now();
    if (now - game.lastMoveEmit > MOVE_THROTTLE) {
      game.lastMoveEmit = now;
      socket.emit('player_move', { x: me.x, y: me.y, dir: me.dir });
    }
  } else {
    me.frame = 0;
  }
}

// ── Input listeners ──
window.addEventListener('keydown', (e) => {
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD'].includes(e.code)) {
    // Don't capture if typing in textarea
    if (document.activeElement === messageInput) return;
    e.preventDefault();
    game.keys.add(e.code);
  }
});
window.addEventListener('keyup', (e) => game.keys.delete(e.code));

// Mobile D-pad
function dpadDown(dir) {
  game.keys.add(dir);
}
function dpadUp(dir) {
  game.keys.delete(dir);
}

['up','down','left','right'].forEach(d => {
  const btn = document.getElementById(`dpad-${d}`);
  const code = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[d];
  btn.addEventListener('touchstart', (e) => { e.preventDefault(); dpadDown(code); }, { passive: false });
  btn.addEventListener('touchend',   (e) => { e.preventDefault(); dpadUp(code); }, { passive: false });
  btn.addEventListener('mousedown',  () => dpadDown(code));
  btn.addEventListener('mouseup',    () => dpadUp(code));
  btn.addEventListener('mouseleave', () => dpadUp(code));
});

// ── Start game ──
function startGame(room) {
  game.map = generateMap(room);
  resizeCanvas();
  prerenderMap();
  requestAnimationFrame(gameLoop);
}

window.addEventListener('resize', () => {
  resizeCanvas();
  ctx.imageSmoothingEnabled = false;
});

// ═══════════════════════════════════════════
// CHAT LOGIC
// ═══════════════════════════════════════════

// ── Login ──
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const username = usernameInput.value.trim();
  if (!username) { usernameInput.focus(); return; }

  const roomInput = loginForm.querySelector('input[name="room"]:checked');
  const room = roomInput ? roomInput.value : 'general';

  myUsername = username;
  currentRoom = room;

  loginScreen.classList.remove('active');
  chatScreen.classList.add('active');

  myAvatar.textContent = username.charAt(0).toUpperCase();
  myName.textContent = username;

  const sidebarAv = document.getElementById('sidebar-avatar');
  const sidebarNm = document.getElementById('sidebar-name');
  if (sidebarAv) sidebarAv.textContent = username.charAt(0).toUpperCase();
  if (sidebarNm) sidebarNm.textContent = username;

  startGame(room);

  // Add own player immediately so camera works before server responds
  game.myId = socket.id;
  game.players.set(socket.id, {
    id: socket.id, username,
    x: MAP_W * TILE / 2, y: MAP_H * TILE / 2,
    dir: 'down', frame: 0, speech: null, typing: false
  });

  socket.emit('join', { username, room });

  setTimeout(() => messageInput.focus(), 300);
});

document.querySelectorAll('.room-option').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.room-option').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
  });
});

// ── Chat Panel Toggle ──
chatToggleBtn.addEventListener('click', () => {
  chatPanelOpen = !chatPanelOpen;
  chatPanel.classList.toggle('hidden', !chatPanelOpen);
  if (chatPanelOpen) {
    unreadCount = 0;
    chatBadge.style.display = 'none';
    scrollToBottom(true);
  }
});

// ── Message Rendering ──
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

function buildMessageEl(msg) {
  if (msg.type === 'system') {
    const div = document.createElement('div');
    div.className = 'msg-system';
    div.innerHTML = `<span class="msg-system-text">${escapeHtml(msg.text)}</span>`;
    lastMsgUser = null; lastMsgTime = 0;
    return div;
  }

  const isMine = msg.username === myUsername;
  const grouped = (msg.username === lastMsgUser) && ((msg.timestamp - lastMsgTime) < GROUP_THRESHOLD);
  const div = document.createElement('div');
  div.className = `msg ${isMine ? 'mine' : 'theirs'}${grouped ? ' grouped' : ''}`;

  if (!isMine) {
    div.innerHTML = `
      <div class="msg-header">
        <span class="msg-username">${escapeHtml(msg.username)}</span>
        <span class="msg-time">${formatTime(msg.timestamp)}</span>
      </div>
      <div class="msg-bubble">${escapeHtml(msg.text)}</div>`;
  } else {
    div.innerHTML = `
      <div class="msg-header">
        <span class="msg-time">${formatTime(msg.timestamp)}</span>
        <span class="msg-username">คุณ</span>
      </div>
      <div class="msg-bubble">${escapeHtml(msg.text)}</div>`;
  }

  lastMsgUser = msg.username;
  lastMsgTime = msg.timestamp;
  return div;
}

function renderMessage(msg) {
  messagesArea.appendChild(buildMessageEl(msg));
}

function scrollToBottom(force = false) {
  const el = messagesArea;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  if (force || nearBottom) el.scrollTop = el.scrollHeight;
}

function clearMessages() {
  messagesArea.innerHTML = `
    <div class="welcome-msg">
      <div class="welcome-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
        </svg>
      </div>
      <p>เริ่มต้นการสนทนาได้เลย!</p>
    </div>`;
  lastMsgUser = null; lastMsgTime = 0;
}

// ── Socket events ──
socket.on('connect', () => {
  game.myId = socket.id;
  if (myUsername && chatScreen.classList.contains('active')) {
    socket.emit('join', { username: myUsername, room: currentRoom });
  }
});

socket.on('message', (msg) => {
  renderMessage(msg);
  if (chatPanelOpen) scrollToBottom();
  else if (msg.type === 'chat') {
    unreadCount++;
    chatBadge.style.display = 'flex';
    chatBadge.textContent = unreadCount > 9 ? '9+' : unreadCount;
  }
});

socket.on('room_history', (messages) => {
  clearMessages();
  const fragment = document.createDocumentFragment();
  messages.forEach(m => fragment.appendChild(buildMessageEl(m)));
  messagesArea.appendChild(fragment);
  scrollToBottom(true);
});

socket.on('room_users', (users) => {
  userCount.textContent = users.length;
  headerUserCount.textContent = users.length;
  userList.innerHTML = users.map(u => `
    <div class="user-item ${u === myUsername ? 'me' : ''}">
      <div class="avatar" style="background:${charColor(u)};width:28px;height:28px;font-size:12px">
        ${escapeHtml(u.charAt(0).toUpperCase())}
      </div>
      <span>${escapeHtml(u)}${u === myUsername ? ' (คุณ)' : ''}</span>
    </div>`).join('');
});

socket.on('rooms_info', (rooms) => {
  roomList.innerHTML = rooms.map(r => `
    <div class="room-item ${r.id === currentRoom ? 'active' : ''}" data-room="${r.id}">
      <span class="room-item-hash">#</span>
      <span>${escapeHtml(r.name)}</span>
      <span class="room-item-count">${r.count}</span>
    </div>`).join('');

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
  game.map = generateMap(room);
  prerenderMap();
  game.players.clear();
  game.myId = socket.id;
});

socket.on('user_typing', ({ username, isTyping: it }) => {
  if (username === myUsername) return;
  if (it) typingUsers.add(username); else typingUsers.delete(username);
  updateTypingDisplay();
});

// ── Player events ──
socket.on('player_positions', (positions) => {
  game.myId = socket.id;
  for (const p of positions) {
    game.players.set(p.id, { id: p.id, username: p.username, x: p.x, y: p.y, dir: p.dir || 'down', frame: 0, speech: null, typing: false });
  }
});

socket.on('player_joined', ({ id, username, x, y, dir }) => {
  if (id === socket.id) return;
  game.players.set(id, { id, username, x, y, dir: dir || 'down', frame: 0, speech: null, typing: false });
});

socket.on('player_moved', ({ id, x, y, dir }) => {
  const p = game.players.get(id);
  if (!p) return;
  p.x = x; p.y = y; p.dir = dir;
  p.frame = (p.frame + 0.2) % 4;
});

socket.on('player_left', ({ id }) => {
  game.players.delete(id);
});

socket.on('player_speech', ({ id, text }) => {
  const p = game.players.get(id);
  if (p) p.speech = { text, ts: Date.now() };
  // Also set for my own player
  if (id === socket.id) {
    const me = game.players.get(game.myId);
    if (me) me.speech = { text, ts: Date.now() };
  }
});

socket.on('player_typing', ({ id, isTyping: it }) => {
  const p = game.players.get(id);
  if (p) p.typing = it;
});


// ── Typing ──
function updateTypingDisplay() {
  if (typingUsers.size === 0) {
    typingIndicator.style.display = 'none';
  } else {
    typingIndicator.style.display = 'flex';
    typingText.textContent = `${Array.from(typingUsers).join(', ')} กำลังพิมพ์...`;
  }
}

messageInput.addEventListener('input', () => {
  const val = messageInput.value;
  charCount.textContent = `${val.length}/500`;
  sendBtn.disabled = !val.trim();

  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 100) + 'px';

  if (!isTyping) {
    isTyping = true;
    socket.emit('typing', { room: currentRoom, isTyping: true });
    const me = game.players.get(game.myId);
    if (me) me.typing = true;
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    isTyping = false;
    socket.emit('typing', { room: currentRoom, isTyping: false });
    const me = game.players.get(game.myId);
    if (me) me.typing = false;
  }, 2000);
});

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

sendBtn.addEventListener('click', sendMessage);

function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;

  socket.emit('chat_message', { text, room: currentRoom });

  // Show speech bubble on own character immediately
  const me = game.players.get(game.myId);
  if (me) me.speech = { text, ts: Date.now() };

  messageInput.value = '';
  messageInput.style.height = 'auto';
  charCount.textContent = '0/500';
  sendBtn.disabled = true;

  clearTimeout(typingTimer);
  if (isTyping) {
    isTyping = false;
    socket.emit('typing', { room: currentRoom, isTyping: false });
    if (me) me.typing = false;
  }
  messageInput.focus();
}

function switchRoom(room) {
  socket.emit('switch_room', room);
}

// ── Sidebar ──
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
  game.players.clear();
  myUsername = '';
  currentRoom = 'general';
  chatPanelOpen = false;
  chatPanel.classList.add('hidden');
  unreadCount = 0;
  chatBadge.style.display = 'none';
  socket.disconnect();
  socket.connect();
  usernameInput.value = '';
  usernameInput.focus();
});

// ── Helpers ──
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
