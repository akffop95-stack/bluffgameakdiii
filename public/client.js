// ─────────────────────────────────────────────────────────────────────────────
//  Bluff Casino – Client
// ─────────────────────────────────────────────────────────────────────────────
const socket = io();

let myId       = null;
let roomCode   = null;
let gameState  = null;
let selected   = new Set(); // indices of selected hand cards

// ═══════════════════════════════════════════════════════════════════════════════
//  Socket listeners
// ═══════════════════════════════════════════════════════════════════════════════

socket.on('room-created', ({ code, playerId }) => {
  myId = playerId;
  roomCode = code;
  q('#displayRoomCode').textContent = code;
  showScreen('lobby');
});

socket.on('room-joined', ({ code, playerId }) => {
  myId = playerId;
  roomCode = code;
  q('#displayRoomCode').textContent = code;
  showScreen('lobby');
});

socket.on('join-error', msg => showError(msg));

socket.on('chat', ({ text }) => addLog(text));

socket.on('game-state', state => {
  gameState = state;
  renderState(state);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  UI helpers
// ═══════════════════════════════════════════════════════════════════════════════

const q = sel => document.querySelector(sel);
const qa = sel => [...document.querySelectorAll(sel)];

function showScreen(name) {
  qa('.screen').forEach(s => s.classList.remove('active'));
  q(`#screen-${name}`).classList.add('active');
}

function showError(msg) {
  const t = q('#errorToast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, 3500);
}

function showNotif(msg) {
  const t = q('#notifToast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, 2500);
}

function addLog(text) {
  const body = q('#logBody');
  if (!body) return;
  const div = document.createElement('div');
  div.className = 'log-msg';
  div.textContent = text;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  User Actions
// ═══════════════════════════════════════════════════════════════════════════════

function createRoom() {
  const name = q('#playerName').value.trim();
  if (!name) return showError('Please enter your name!');
  if (name.length < 2) return showError('Name must be at least 2 characters!');
  socket.emit('create-room', { playerName: name });
}

function joinRoom() {
  const name = q('#playerName').value.trim();
  const code = q('#roomCodeInput').value.trim().toUpperCase();
  if (!name) return showError('Please enter your name!');
  if (code.length !== 5) return showError('Room code must be exactly 5 characters!');
  socket.emit('join-room', { code, playerName: name });
}

function copyRoomCode() {
  if (!roomCode) return;
  navigator.clipboard.writeText(roomCode)
    .then(() => showNotif('✅ Room code copied!'))
    .catch(() => showNotif(roomCode));
}

function startVoting() { socket.emit('start-voting'); }

function voteForDealer(id) {
  const me = gameState?.players.find(p => p.id === myId);
  if (me?.vote !== null && me?.vote !== undefined) return;
  socket.emit('vote-dealer', { votedForId: id });
}

function adjustBet(delta) {
  const inp = q('#betInput');
  const me = gameState?.players.find(p => p.id === myId);
  const max = me ? me.money : 5000;
  inp.value = Math.max(100, Math.min(max, parseInt(inp.value || 0) + delta));
}
function setBet(v) { q('#betInput').value = v; }
function setBetAll() {
  const me = gameState?.players.find(p => p.id === myId);
  if (me) q('#betInput').value = me.money;
}

function placeBet() {
  const amount = parseInt(q('#betInput').value);
  socket.emit('place-bet', { amount });
  q('#confirmBetBtn').disabled = true;
  q('#confirmBetBtn').textContent = '⏳ Waiting for others…';
}

function callBluff() { socket.emit('call-bluff'); }

function toggleCard(idx) {
  if (selected.has(idx)) selected.delete(idx);
  else selected.add(idx);
  renderHand(gameState);
}

function playSelectedCards() {
  if (selected.size === 0) return showError('Select at least 1 card!');
  socket.emit('play-cards', { cardIndices: [...selected] });
  selected.clear();
}

function playAgain() { socket.emit('play-again'); }

// ═══════════════════════════════════════════════════════════════════════════════
//  Master render dispatcher
// ═══════════════════════════════════════════════════════════════════════════════

function renderState(state) {
  switch (state.state) {
    case 'lobby':    showScreen('lobby');    renderLobby(state);    break;
    case 'voting':   showScreen('voting');   renderVoting(state);   break;
    case 'betting':  showScreen('betting');  renderBetting(state);  break;
    case 'playing':  showScreen('game');     renderGame(state);     break;
    case 'gameover': showScreen('gameover'); renderGameOver(state); break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  LOBBY
// ─────────────────────────────────────────────────────────────────────────────

function renderLobby(state) {
  const seats = q('#lobbySeats');
  seats.innerHTML = '';

  for (let i = 0; i < 3; i++) {
    const p = state.players[i];
    const div = el('div', `lobby-seat${p ? (p.isHost ? ' host filled' : ' filled') : ' empty'}`);
    if (p) {
      div.innerHTML = `
        <span class="seat-avatar">${p.avatar}</span>
        <div class="seat-name">${esc(p.name)}${p.id === myId ? ' <em style="color:#8a9980;font-size:0.75em">(you)</em>' : ''}</div>
        ${p.isHost ? '<span class="seat-badge">HOST</span>' : ''}
        ${p.isDealer ? '<span class="seat-badge" style="background:#60a5fa;color:#000">DEALER</span>' : ''}
      `;
    } else {
      div.innerHTML = `
        <span class="seat-avatar" style="opacity:0.3">🪑</span>
        <div class="seat-empty-label">Waiting for player…</div>
      `;
    }
    seats.appendChild(div);
  }

  q('#lobbyStatus').textContent = `${state.players.length}/3 players at the table`;

  const btn = q('#startVotingBtn');
  const me = state.players.find(p => p.id === myId);
  btn.classList.toggle('hidden', !(me?.isHost && state.players.length === 3));
}

// ─────────────────────────────────────────────────────────────────────────────
//  VOTING
// ─────────────────────────────────────────────────────────────────────────────

function renderVoting(state) {
  const me = state.players.find(p => p.id === myId);
  const hasVoted = me?.vote !== null && me?.vote !== undefined;
  const votesIn = state.players.filter(p => p.vote !== null && p.vote !== undefined).length;

  const grid = q('#voteGrid');
  grid.innerHTML = '';

  state.players.forEach(p => {
    const votesFor = state.players.filter(v => v.vote === p.id).length;
    const isMyVote = me?.vote === p.id;

    const card = el('div', `vote-card${isMyVote ? ' voted' : ''}${hasVoted ? ' no-click' : ''}`);
    card.innerHTML = `
      <div class="vc-avatar">${p.avatar}</div>
      <div class="vc-name">${esc(p.name)}${p.id === myId ? ' <em style="font-size:0.75em;color:#8a9980">(you)</em>' : ''}</div>
      <div class="vc-votes">${votesFor} vote${votesFor !== 1 ? 's' : ''}</div>
      ${isMyVote ? '<div class="vc-check">✓ Your vote</div>' : ''}
    `;
    if (!hasVoted) card.onclick = () => voteForDealer(p.id);
    grid.appendChild(card);
  });

  q('#voteStatus').textContent = hasVoted
    ? `Waiting for others… (${votesIn}/3 voted)`
    : 'Click a player to vote them as Dealer!';
}

// ─────────────────────────────────────────────────────────────────────────────
//  BETTING
// ─────────────────────────────────────────────────────────────────────────────

function renderBetting(state) {
  const dealer = state.players.find(p => p.isDealer);
  q('#dealerLabel').textContent = dealer ? `🃏 ${dealer.name} is the Dealer!` : '';

  const row = q('#betPlayerRow');
  row.innerHTML = '';
  state.players.forEach(p => {
    const card = el('div', `bet-pc${p.isDealer ? ' is-dealer' : ''}${p.betConfirmed ? ' confirmed' : ''}`);
    card.innerHTML = `
      <div class="bet-pc-avatar">${p.avatar}</div>
      <div class="bet-pc-name">${esc(p.name)}${p.id === myId ? ' <em style="font-size:0.75em">(you)</em>' : ''}</div>
      ${p.isDealer ? '<div class="seat-badge" style="background:#60a5fa;color:#000">DEALER</div>' : ''}
      <div class="bet-pc-status" style="margin-top:8px">
        ${p.betConfirmed
          ? `<span style="color:#4ade80">✅ Bet placed</span>`
          : `<span style="color:#8a9980">⏳ Placing bet…</span>`}
      </div>
      <div style="font-size:0.72rem;color:#8a9980;margin-top:4px">Balance: $${p.money}</div>
    `;
    row.appendChild(card);
  });

  const me = state.players.find(p => p.id === myId);
  const betBox = q('#betBox');
  if (me?.betConfirmed) {
    betBox.innerHTML = `
      <div style="text-align:center;font-size:1.1rem;color:#4ade80;padding:10px 0">
        ✅ Your bet of <strong>$${me.bet}</strong> is confirmed!<br>
        <span style="color:#8a9980;font-size:0.85rem;margin-top:6px;display:block">Waiting for others…</span>
      </div>`;
  } else if (me) {
    q('#myBalance').textContent = me.money;
    const inp = q('#betInput');
    inp.max = me.money;
    if (parseInt(inp.value) > me.money) inp.value = me.money;
    q('#confirmBetBtn').disabled = false;
    q('#confirmBetBtn').textContent = '✅ Confirm Bet';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  GAME
// ─────────────────────────────────────────────────────────────────────────────

function renderGame(state) {
  const me = state.players.find(p => p.id === myId);
  const opponents = state.players.filter(p => p.id !== myId);
  const isMyTurn = state.currentPlayerId === myId;

  // ── Opponents ──
  const oppRow = q('#opponentsRow');
  oppRow.innerHTML = '';
  opponents.forEach(p => {
    const active = p.id === state.currentPlayerId;
    const slot = el('div', `player-slot${active ? ' my-turn' : ''}${p.isDealer ? ' is-dealer' : ''}`);
    // Mini card backs
    const backs = Array.from({ length: Math.min(p.handCount, 10) },
      () => '<span class="card-back-mini"></span>').join('');
    slot.innerHTML = `
      <div class="ps-avatar">${p.avatar}${p.isDealer ? ' 🃏' : ''}</div>
      <div class="ps-name">${esc(p.name)}</div>
      <div class="ps-money">$${p.money}</div>
      <div class="ps-cards">${backs}</div>
      <div class="ps-cards" style="font-size:0.68rem;color:#8a9980">${p.handCount} cards</div>
      ${active ? '<div class="ps-turn-tag">▶ THEIR TURN</div>' : ''}
      ${!p.connected ? '<div style="font-size:0.68rem;color:#ff6666">⚠ Disconnected</div>' : ''}
    `;
    oppRow.appendChild(slot);
  });

  // ── Pile / Pot / Rank ──
  q('#pileCount').textContent = state.pileCount ?? 0;
  q('#potAmount').textContent = state.pot ?? 0;
  q('#currentRank').textContent = state.currentRank ?? 'A';

  // ── Last play ──
  const lp = q('#lastPlayRow');
  lp.textContent = state.lastPlay
    ? `Last play: ${state.lastPlay.playerName} played ${state.lastPlay.cardCount} ${state.lastPlay.claimedRank}(s) face-down`
    : '';

  // ── Bluff result banner ──
  const bb = q('#bluffBanner');
  if (state.bluffResult) {
    const { wasBluffing, callerName, accusedName, actualCards, claimedRank, loserName } = state.bluffResult;
    const cardsStr = actualCards.map(c => c.rank + c.suit).join(', ');
    bb.innerHTML = wasBluffing
      ? `🎯 <strong style="color:#4ade80">BLUFF CAUGHT!</strong> ${esc(accusedName)} played <em>${cardsStr}</em> as ${claimedRank}s — <strong>${esc(loserName)}</strong> picks up the pile!`
      : `❌ <strong style="color:#ff6666">WRONG CALL!</strong> ${esc(accusedName)} was honest. <strong>${esc(loserName)}</strong> picks up the pile!`;
    bb.classList.remove('hidden');
  } else {
    bb.classList.add('hidden');
    bb.innerHTML = '';
  }

  // ── Me bar ──
  const meBar = q('#meBar');
  meBar.innerHTML = '';
  if (me) {
    const slot = el('div', `player-slot${isMyTurn ? ' my-turn' : ''}${me.isDealer ? ' is-dealer' : ''}`);
    slot.innerHTML = `
      <div class="ps-avatar">${me.avatar}${me.isDealer ? ' 🃏' : ''} <em style="font-size:0.65rem;color:#8a9980">YOU</em></div>
      <div class="ps-name">${esc(me.name)}</div>
      <div class="ps-money">$${me.money}</div>
      ${isMyTurn ? '<div class="ps-turn-tag">▶ YOUR TURN</div>' : ''}
    `;
    meBar.appendChild(slot);
  }

  // ── Hand ──
  renderHand(state);

  // ── Action buttons ──
  renderActionButtons(state, isMyTurn);
}

function renderHand(state) {
  const s = state || gameState;
  if (!s) return;
  const me = s.players.find(p => p.id === myId);
  const isMyTurn = s.currentPlayerId === myId;
  const hand = me?.hand || [];

  const hc = q('#handCount');
  if (hc) hc.textContent = hand.length;

  const hint = q('#handHint');
  if (hint) hint.textContent = isMyTurn ? `— Select cards to claim as ${s.currentRank}s` : '';

  const container = q('#handCards');
  if (!container) return;
  container.innerHTML = '';

  hand.forEach((card, idx) => {
    const isRed = card.suit === '♥' || card.suit === '♦';
    const isSel = selected.has(idx);
    const div = el('div', `card ${isRed ? 'red' : 'black'}${isSel ? ' selected' : ''}${!isMyTurn ? ' no-select' : ''}`);
    div.innerHTML = `<div class="card-rank">${card.rank}</div><div class="card-suit">${card.suit}</div>`;
    if (isMyTurn) div.onclick = () => toggleCard(idx);
    container.appendChild(div);
  });

  // Play confirm bar
  const pc = q('#playConfirm');
  if (!pc) return;
  if (isMyTurn && selected.size > 0) {
    pc.classList.remove('hidden');
    q('#playConfirmText').innerHTML =
      `Playing <b>${selected.size}</b> card${selected.size > 1 ? 's' : ''} &nbsp;→&nbsp; claiming <b>${selected.size} ${s.currentRank}${selected.size > 1 ? 's' : ''}</b>`;
  } else {
    pc.classList.add('hidden');
  }
}

function renderActionButtons(state, isMyTurn) {
  const container = q('#tableButtons');
  container.innerHTML = '';

  const canCallBluff = state.lastPlay && state.lastPlay.playerId !== myId;

  if (canCallBluff) {
    const btn = el('button', 'tbl-btn tbl-btn-bluff', '🚨 CALL BLUFF!');
    btn.onclick = callBluff;
    container.appendChild(btn);
  }

  if (isMyTurn) {
    const info = el('div', '', `<span style="color:var(--gold);font-size:0.85rem">Your turn! Select 1–4 cards to claim as <strong>${state.currentRank}</strong>s</span>`);
    container.appendChild(info);
  } else {
    const cur = state.players.find(p => p.id === state.currentPlayerId);
    if (cur) {
      const info = el('div', '', `<span style="color:#8a9980;font-size:0.82rem">Waiting for <strong style="color:var(--gold)">${esc(cur.name)}</strong> to play…</span>`);
      container.appendChild(info);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  GAME OVER
// ─────────────────────────────────────────────────────────────────────────────

function renderGameOver(state) {
  if (state.winner) {
    q('#goTitle').textContent = `${state.winner.name} Wins!`;
    q('#goPrize').textContent = `🏆 Prize collected: $${state.winner.prize}`;
  }

  const standings = q('#goStandings');
  standings.innerHTML = '';
  state.players.forEach(p => {
    const isWinner = p.name === state.winner?.name;
    const card = el('div', `go-card${isWinner ? ' winner' : ''}`);
    card.innerHTML = `
      <div class="go-card-avatar">${p.avatar}</div>
      <div class="go-card-name">${esc(p.name)}</div>
      <div class="go-card-money">$${p.money}</div>
      ${isWinner ? '<div class="go-card-tag">🏆 WINNER</div>' : ''}
    `;
    standings.appendChild(card);
  });

  const me = state.players.find(p => p.id === myId);
  q('#playAgainBtn').classList.toggle('hidden', !me?.isHost);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Misc helpers
// ═══════════════════════════════════════════════════════════════════════════════

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const screen = document.querySelector('.screen.active')?.id;
    if (screen === 'screen-landing') {
      const code = q('#roomCodeInput').value.trim();
      code ? joinRoom() : createRoom();
    }
  }
});

// Auto-uppercase room code input
q('#roomCodeInput').addEventListener('input', function() {
  this.value = this.value.toUpperCase();
});
