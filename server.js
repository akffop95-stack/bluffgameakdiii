const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ─── Constants ────────────────────────────────────────────────────────────────
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
const AVATARS = ['🎩', '🎭', '🃏', '👑', '💎', '🎰'];
const STARTING_MONEY = 5000;
const MIN_BET = 100;

// ─── Utilities ────────────────────────────────────────────────────────────────
function createDeck() {
  const deck = [];
  for (const suit of SUITS)
    for (const rank of RANKS)
      deck.push({ rank, suit });
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++)
    code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ─── Room State ───────────────────────────────────────────────────────────────
const rooms = {};

function makePlayer(socketId, name, isHost, avatarIdx) {
  return {
    id: socketId,
    name: name.trim(),
    money: STARTING_MONEY,
    hand: [],
    vote: null,
    bet: 0,
    betConfirmed: false,
    isHost,
    isDealer: false,
    connected: true,
    avatar: AVATARS[avatarIdx % AVATARS.length]
  };
}

function makeRoom(code, hostPlayer) {
  return {
    code,
    players: [hostPlayer],
    state: 'lobby',       // lobby | voting | betting | playing | gameover
    pile: [],
    currentPlayerIdx: 0,
    currentRankIdx: 0,
    pot: 0,
    lastPlay: null,       // { playerId, playerName, claimedRank, actualCards, cardCount }
    dealerIdx: -1,
    winner: null,         // { name, prize, totalMoney }
    voteResult: null,     // { dealerName }
    bluffResult: null,    // { callerName, accusedName, wasBluffing, actualCards, claimedRank, loserName }
  };
}

function getPlayerRoom(socketId) {
  return Object.values(rooms).find(r => r.players.some(p => p.id === socketId));
}

// ─── Broadcast helpers ────────────────────────────────────────────────────────
function sysMsg(code, text) {
  io.to(code).emit('chat', { system: true, text });
}

function broadcastState(code) {
  const room = rooms[code];
  if (!room) return;

  room.players.forEach(player => {
    const sock = io.sockets.sockets.get(player.id);
    if (!sock) return;

    sock.emit('game-state', {
      code: room.code,
      state: room.state,
      pot: room.pot,
      pileCount: room.pile.length,
      currentPlayerId: room.players[room.currentPlayerIdx]?.id,
      currentRank: RANKS[room.currentRankIdx],
      lastPlay: room.lastPlay
        ? {
            playerId: room.lastPlay.playerId,
            playerName: room.lastPlay.playerName,
            claimedRank: room.lastPlay.claimedRank,
            cardCount: room.lastPlay.cardCount
          }
        : null,
      bluffResult: room.bluffResult,
      winner: room.winner,
      voteResult: room.voteResult,
      myId: player.id,
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        money: p.money,
        handCount: p.hand.length,
        hand: p.id === player.id ? p.hand : null,
        vote: p.vote,
        bet: p.bet,
        betConfirmed: p.betConfirmed,
        isHost: p.isHost,
        isDealer: p.isDealer,
        connected: p.connected,
        avatar: p.avatar
      }))
    });
  });
}

// ─── Game logic ───────────────────────────────────────────────────────────────
function resolveVoting(room) {
  const counts = {};
  room.players.forEach(p => {
    counts[p.vote] = (counts[p.vote] || 0) + 1;
  });

  const maxVotes = Math.max(...Object.values(counts));
  const topIds = Object.entries(counts)
    .filter(([, c]) => c === maxVotes)
    .map(([id]) => id);

  // Break ties randomly
  const dealerId = topIds[Math.floor(Math.random() * topIds.length)];
  const dealerIdx = room.players.findIndex(p => p.id === dealerId);

  room.dealerIdx = dealerIdx;
  room.players.forEach((p, i) => { p.isDealer = i === dealerIdx; });
  room.voteResult = { dealerName: room.players[dealerIdx].name };
  room.state = 'betting';

  sysMsg(room.code, `🃏 ${room.voteResult.dealerName} has been elected as the Dealer!`);
  broadcastState(room.code);
}

function startGame(room) {
  const deck = shuffle(createDeck());
  const n = room.players.length;
  room.players.forEach(p => { p.hand = []; });
  deck.forEach((card, i) => room.players[i % n].hand.push(card));

  room.state = 'playing';
  room.pile = [];
  room.lastPlay = null;
  room.bluffResult = null;
  room.currentRankIdx = 0;
  // Player LEFT of dealer starts
  room.currentPlayerIdx = (room.dealerIdx + 1) % n;

  const firstPlayer = room.players[room.currentPlayerIdx];
  sysMsg(room.code, `🎴 Cards dealt! ${firstPlayer.name} goes first — claim Aces!`);
  broadcastState(room.code);
}

function endGame(room, winner) {
  winner.money += room.pot;
  room.winner = { name: winner.name, prize: room.pot, totalMoney: winner.money };
  room.state = 'gameover';

  sysMsg(room.code, `🏆 ${winner.name} wins the pot of $${room.pot}!`);
  broadcastState(room.code);
}

function resetRoom(room) {
  room.state = 'lobby';
  room.pile = [];
  room.currentPlayerIdx = 0;
  room.currentRankIdx = 0;
  room.pot = 0;
  room.lastPlay = null;
  room.dealerIdx = -1;
  room.winner = null;
  room.voteResult = null;
  room.bluffResult = null;
  room.players.forEach(p => {
    p.hand = [];
    p.vote = null;
    p.bet = 0;
    p.betConfirmed = false;
    p.isDealer = false;
  });
}

// ─── Socket handlers ──────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log('[+] Connected:', socket.id);

  // ── Create Room ──
  socket.on('create-room', ({ playerName }) => {
    if (!playerName?.trim()) return;
    const code = generateRoomCode();
    const player = makePlayer(socket.id, playerName, true, 0);
    rooms[code] = makeRoom(code, player);
    socket.join(code);
    socket.emit('room-created', { code, playerId: socket.id });
    sysMsg(code, `🎰 ${player.name} created the table!`);
    broadcastState(code);
  });

  // ── Join Room ──
  socket.on('join-room', ({ code, playerName }) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) return socket.emit('join-error', '❌ Room not found! Check the code.');
    if (room.state !== 'lobby') return socket.emit('join-error', '❌ Game already started!');
    if (room.players.length >= 3) return socket.emit('join-error', '❌ Table is full! (Max 3 players)');
    if (!playerName?.trim()) return socket.emit('join-error', '❌ Please enter your name!');
    if (room.players.some(p => p.name.toLowerCase() === playerName.trim().toLowerCase()))
      return socket.emit('join-error', '❌ Name already taken in this room!');

    const player = makePlayer(socket.id, playerName, false, room.players.length);
    room.players.push(player);
    socket.join(code);
    socket.emit('room-joined', { code, playerId: socket.id });
    sysMsg(code, `🃏 ${player.name} joined the table!`);
    broadcastState(code);
  });

  // ── Start Voting ──
  socket.on('start-voting', () => {
    const room = getPlayerRoom(socket.id);
    if (!room) return;
    const me = room.players.find(p => p.id === socket.id);
    if (!me?.isHost) return;
    if (room.players.length < 3) return socket.emit('join-error', '❌ Need exactly 3 players to start!');

    room.state = 'voting';
    room.players.forEach(p => { p.vote = null; });
    sysMsg(room.code, '🗳️ Dealer voting has begun! Cast your vote!');
    broadcastState(room.code);
  });

  // ── Vote for Dealer ──
  socket.on('vote-dealer', ({ votedForId }) => {
    const room = getPlayerRoom(socket.id);
    if (!room || room.state !== 'voting') return;
    const voter = room.players.find(p => p.id === socket.id);
    if (!voter || voter.vote !== null) return;
    if (!room.players.some(p => p.id === votedForId)) return;

    voter.vote = votedForId;
    const votesIn = room.players.filter(p => p.vote !== null).length;
    const votedName = room.players.find(p => p.id === votedForId)?.name;
    sysMsg(room.code, `${voter.name} voted → ${votedName}`);

    if (votesIn === room.players.length) {
      resolveVoting(room);
    } else {
      broadcastState(room.code);
    }
  });

  // ── Place Bet ──
  socket.on('place-bet', ({ amount }) => {
    const room = getPlayerRoom(socket.id);
    if (!room || room.state !== 'betting') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.betConfirmed) return;

    amount = parseInt(amount);
    if (isNaN(amount) || amount < MIN_BET || amount > player.money)
      return socket.emit('join-error', `❌ Bet must be $${MIN_BET}–$${player.money}`);

    player.bet = amount;
    player.money -= amount;
    player.betConfirmed = true;
    room.pot += amount;

    sysMsg(room.code, `💰 ${player.name} placed a bet of $${amount}!`);

    if (room.players.every(p => p.betConfirmed)) {
      startGame(room);
    } else {
      broadcastState(room.code);
    }
  });

  // ── Play Cards ──
  socket.on('play-cards', ({ cardIndices }) => {
    const room = getPlayerRoom(socket.id);
    if (!room || room.state !== 'playing') return;
    const cur = room.players[room.currentPlayerIdx];
    if (cur.id !== socket.id) return;

    if (!Array.isArray(cardIndices) || cardIndices.length < 1 || cardIndices.length > 4) return;
    const valid = cardIndices.filter(i => Number.isInteger(i) && i >= 0 && i < cur.hand.length);
    if (valid.length !== cardIndices.length) return;

    const claimedRank = RANKS[room.currentRankIdx];
    const playedCards = valid.map(i => cur.hand[i]);

    // Remove from hand (higher indices first to avoid shifting)
    const sorted = [...valid].sort((a, b) => b - a);
    sorted.forEach(i => cur.hand.splice(i, 1));

    room.pile.push(...playedCards);
    room.lastPlay = {
      playerId: socket.id,
      playerName: cur.name,
      claimedRank,
      actualCards: playedCards,
      cardCount: playedCards.length
    };
    room.bluffResult = null;

    // Advance turn
    room.currentRankIdx = (room.currentRankIdx + 1) % RANKS.length;
    room.currentPlayerIdx = (room.currentPlayerIdx + 1) % room.players.length;

    sysMsg(room.code,
      `🃏 ${cur.name} played ${playedCards.length} card${playedCards.length > 1 ? 's' : ''} claiming ${playedCards.length} ${claimedRank}${playedCards.length > 1 ? 's' : ''}`);

    if (cur.hand.length === 0) {
      endGame(room, cur);
      return;
    }

    broadcastState(room.code);
  });

  // ── Call Bluff ──
  socket.on('call-bluff', () => {
    const room = getPlayerRoom(socket.id);
    if (!room || room.state !== 'playing' || !room.lastPlay) return;
    if (room.lastPlay.playerId === socket.id) return; // can't call bluff on yourself

    const caller = room.players.find(p => p.id === socket.id);
    const accused = room.players.find(p => p.id === room.lastPlay.playerId);
    if (!caller || !accused) return;

    const { actualCards, claimedRank } = room.lastPlay;
    const wasBluffing = actualCards.some(c => c.rank !== claimedRank);

    let loser;
    if (wasBluffing) {
      accused.hand.push(...room.pile);
      loser = accused;
    } else {
      caller.hand.push(...room.pile);
      loser = caller;
    }

    room.bluffResult = {
      callerName: caller.name,
      accusedName: accused.name,
      wasBluffing,
      actualCards,
      claimedRank,
      loserName: loser.name
    };

    const pileSize = room.pile.length;
    room.pile = [];
    room.lastPlay = null;
    room.currentPlayerIdx = room.players.findIndex(p => p.id === loser.id);

    sysMsg(room.code,
      wasBluffing
        ? `🎯 BLUFF CAUGHT! ${accused.name} was lying! They pick up ${pileSize} cards.`
        : `❌ ${caller.name} was WRONG! ${accused.name} was honest. ${caller.name} picks up ${pileSize} cards.`
    );

    broadcastState(room.code);

    // Auto-clear bluff result after 5 seconds
    setTimeout(() => {
      if (room && room.bluffResult) {
        room.bluffResult = null;
        broadcastState(room.code);
      }
    }, 5000);
  });

  // ── Play Again ──
  socket.on('play-again', () => {
    const room = getPlayerRoom(socket.id);
    if (!room || room.state !== 'gameover') return;
    const me = room.players.find(p => p.id === socket.id);
    if (!me?.isHost) return;

    resetRoom(room);
    sysMsg(room.code, '🔄 New game starting — back to the lobby!');
    broadcastState(room.code);
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    const room = getPlayerRoom(socket.id);
    if (room) {
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.connected = false;
        sysMsg(room.code, `⚠️ ${player.name} disconnected.`);
        broadcastState(room.code);
      }
    }
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🃏 Bluff Casino running at http://localhost:${PORT}\n`);
});
