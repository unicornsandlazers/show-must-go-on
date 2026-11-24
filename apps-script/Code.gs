/**
 * The Show Must Go On — backend for the party missions game.
 *
 * Lives in Google Apps Script, bound to a Google Sheet. All secrets (missions,
 * the party address) stay in the Sheet; the public website only ever receives
 * what one request needs.
 *
 * Sheets (created by setup()):
 *   Players : Name | Mission | Decoy 1 | Decoy 2
 *   RSVP    : Name | Status (play / watch / no) | Updated
 *   Votes   : Performer | Voter | Choice | Updated
 *   State   : Key | Value   (phase, order, round, revealed, notDone)
 *   Config  : Key | Value   (title, date, time, address, host, note)
 *
 * Deploy: Deploy > New deployment > Web app, Execute as "Me",
 * Who has access "Anyone". Run setup() once first; it logs the admin key.
 */

var SHEET = { players: 'Players', rsvp: 'RSVP', votes: 'Votes', state: 'State', config: 'Config' };
var STATUSES = ['play', 'watch', 'no'];
var CACHE_KEY = 'snapshot-v1';
var CACHE_SECONDS = 10;

// ---------------------------------------------------------------- entry point

function doGet(e) {
  var p = (e && e.parameter) || {};
  var out;
  try {
    out = { ok: true, data: route_(p) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function route_(p) {
  switch (p.action) {
    case 'init':
      return getInit_();
    case 'missions':
      return getMissions_(p.name);
    case 'rsvp':
      return withLock_(function () { return setRsvp_(p.name, p.status); });
    case 'state':
      return getState_(p.voter || null);
    case 'vote':
      return withLock_(function () { return castVote_(p.voter, p.performer, Number(p.choice)); });
    case 'admin':
      checkKey_(p.key);
      return withLock_(function () { return admin_(p.cmd, p); });
    default:
      throw new Error('Unknown action');
  }
}

// ---------------------------------------------------------------- one-time setup

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEET.players, ['Name', 'Mission', 'Decoy 1', 'Decoy 2']);
  ensureSheet_(ss, SHEET.rsvp, ['Name', 'Status', 'Updated']);
  ensureSheet_(ss, SHEET.votes, ['Performer', 'Voter', 'Choice', 'Updated']);
  ensureSheet_(ss, SHEET.state, ['Key', 'Value']);
  var config = ensureSheet_(ss, SHEET.config, ['Key', 'Value']);
  if (config.getLastRow() < 2) {
    config.getRange(2, 1, 6, 2).setValues([
      ['title', 'The Show Must Go On'],
      ['date', 'Saturday 28 November'],
      ['time', '20:00'],
      ['address', 'Fill in the address'],
      ['host', 'Jan'],
      ['note', 'Bring good vibes. Missions are top secret.']
    ]);
  }
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('ADMIN_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    props.setProperty('ADMIN_KEY', key);
  }
  Logger.log('Admin key: ' + key);
  Logger.log('TV page: <your site>/tv.html?key=' + key);
}

function ensureSheet_(ss, name, header) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() < 1) sh.getRange(1, 1, 1, header.length).setValues([header]);
  return sh;
}

// ---------------------------------------------------------------- data access

function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Missing sheet "' + name + '". Run setup() first.');
  return sh;
}

/** All rows below the header, as arrays. */
function rows_(name) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
}

function kv_(name, asShown) {
  var out = {};
  var rows = rows_(name);
  if (asShown && rows.length) {
    // What the Sheet shows, so a date or time typed into Config is not turned
    // into a long machine date like "Sat Nov 28 2026 00:00:00 GMT+0100".
    var sh = sheet_(name);
    rows = sh.getRange(2, 1, rows.length, 2).getDisplayValues();
  }
  rows.forEach(function (r) {
    var k = String(r[0]).trim();
    if (k) out[k] = r[1] === '' || r[1] === null ? '' : String(r[1]);
  });
  return out;
}

/** Everything the game reads, cached briefly so 20 polling phones stay cheap. */
function snapshot_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CACHE_KEY);
  if (hit) return JSON.parse(hit);

  var players = rows_(SHEET.players)
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r, idx) {
      return { idx: idx, name: String(r[0]).trim(), real: String(r[1]).trim(), decoys: [String(r[2]).trim(), String(r[3]).trim()] };
    });
  var rsvp = {};
  rows_(SHEET.rsvp).forEach(function (r) {
    var n = String(r[0]).trim();
    if (n) rsvp[n] = String(r[1]).trim();
  });
  var votes = {};
  rows_(SHEET.votes).forEach(function (r) {
    var perf = String(r[0]).trim(), voter = String(r[1]).trim();
    if (!perf || !voter) return;
    if (!votes[perf]) votes[perf] = {};
    votes[perf][voter] = Number(r[2]);
  });
  var st = kv_(SHEET.state);
  var snap = {
    players: players,
    rsvp: rsvp,
    votes: votes,
    config: kv_(SHEET.config, true),
    state: {
      phase: st.phase || 'lobby',
      order: parseList_(st.order),
      round: Number(st.round) || 0,
      revealed: parseList_(st.revealed),
      notDone: parseList_(st.notDone)
    }
  };
  cache.put(CACHE_KEY, JSON.stringify(snap), CACHE_SECONDS);
  return snap;
}

function invalidate_() {
  CacheService.getScriptCache().remove(CACHE_KEY);
}

function parseList_(s) {
  if (!s) return [];
  try {
    var v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function writeState_(state) {
  var sh = sheet_(SHEET.state);
  var values = [
    ['phase', state.phase],
    ['order', JSON.stringify(state.order)],
    ['round', state.round],
    ['revealed', JSON.stringify(state.revealed)],
    ['notDone', JSON.stringify(state.notDone)]
  ];
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 2).clearContent();
  sh.getRange(2, 1, values.length, 2).setValues(values);
  invalidate_();
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Server is busy, try again.');
  try {
    invalidate_();
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function checkKey_(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!expected) throw new Error('ADMIN_KEY is not set. Run setup() first.');
  if (String(key || '') !== expected) throw new Error('Wrong admin key');
}

function findPlayer_(snap, name) {
  for (var i = 0; i < snap.players.length; i++) {
    if (snap.players[i].name === name) return snap.players[i];
  }
  return null;
}

// ---------------------------------------------------------------- guest actions

function getInit_() {
  var snap = snapshot_();
  var c = snap.config;
  return {
    config: { title: c.title || '', date: c.date || '', time: c.time || '', address: c.address || '', host: c.host || '', note: c.note || '' },
    names: snap.players.map(function (p) { return p.name; }).sort(function (a, b) { return a.localeCompare(b); }),
    rsvp: snap.rsvp,
    phase: snap.state.phase
  };
}

function getMissions_(name) {
  var p = findPlayer_(snapshot_(), name);
  if (!p) throw new Error('Unknown player');
  return { name: p.name, real: p.real, decoys: p.decoys };
}

function setRsvp_(name, status) {
  var snap = snapshot_();
  if (!findPlayer_(snap, name)) throw new Error('Unknown player');
  if (STATUSES.indexOf(status) < 0) throw new Error('Unknown answer');
  var sh = sheet_(SHEET.rsvp);
  var rows = rows_(SHEET.rsvp);
  var now = new Date();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === name) {
      sh.getRange(i + 2, 2, 1, 2).setValues([[status, now]]);
      invalidate_();
      return { name: name, status: status };
    }
  }
  sh.appendRow([name, status, now]);
  invalidate_();
  return { name: name, status: status };
}

function castVote_(voter, performer, choice) {
  var snap = snapshot_();
  var st = snap.state;
  if (st.phase !== 'voting') throw new Error('Voting is closed');
  if (st.order[st.round] !== performer) throw new Error('This round is over');
  if (!findPlayer_(snap, voter)) throw new Error('Unknown player');
  if (voter === performer) throw new Error('You cannot vote on yourself');
  if (!(choice === 0 || choice === 1 || choice === 2)) throw new Error('Invalid choice');

  var sh = sheet_(SHEET.votes);
  var rows = rows_(SHEET.votes);
  var now = new Date();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === performer && String(rows[i][1]).trim() === voter) {
      sh.getRange(i + 2, 3, 1, 2).setValues([[choice, now]]);
      invalidate_();
      return { performer: performer, choice: choice };
    }
  }
  sh.appendRow([performer, voter, choice, now]);
  invalidate_();
  return { performer: performer, choice: choice };
}

// ---------------------------------------------------------------- game state

/** Orders the 3 missions the same way every time for a given player. */
function optionsFor_(player) {
  var items = [{ text: player.real, real: true }, { text: player.decoys[0] }, { text: player.decoys[1] }];
  var seed = 2166136261;
  var key = player.name + '|' + player.real;
  for (var i = 0; i < key.length; i++) seed = Math.imul(seed ^ key.charCodeAt(i), 16777619) >>> 0;
  function rand() { // mulberry32
    seed = (seed + 0x6D2B79F5) >>> 0;
    var t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  // Decoys go in random order; the real mission's slot rotates A, B, C down
  // the Players sheet so every letter is right about equally often.
  if (rand() < 0.5) items = [items[0], items[2], items[1]];
  var slot = typeof player.idx === 'number' ? player.idx % 3 : Math.floor(rand() * 3);
  var real = items.shift();
  items.splice(slot, 0, real);
  var correct = 0;
  items.forEach(function (it, idx) { if (it.real) correct = idx; });
  return { texts: items.map(function (it) { return it.text; }), correct: correct };
}

/**
 * Points for one round.
 *  - everybody right: each guesser +1, performer 0
 *  - nobody right (or no votes): nobody scores
 *  - otherwise: each right guesser +2, performer +1 per fooled voter
 *    (performer gets nothing if the host marked the mission as not done)
 */
function scoreRound_(votesMap, correct, performer, notDone) {
  var voters = Object.keys(votesMap || {});
  var right = voters.filter(function (v) { return votesMap[v] === correct; });
  var pts = {};
  var n = voters.length, c = right.length;
  if (n === 0 || c === 0) return { points: pts, right: c, total: n };
  if (c === n) {
    right.forEach(function (v) { pts[v] = 1; });
  } else {
    right.forEach(function (v) { pts[v] = 2; });
    if (notDone.indexOf(performer) < 0) pts[performer] = n - c;
  }
  return { points: pts, right: c, total: n };
}

function leaderboard_(snap) {
  var totals = {};
  snap.players.forEach(function (p) {
    var s = snap.rsvp[p.name];
    if (s === 'play' || s === 'watch') totals[p.name] = 0;
  });
  snap.state.revealed.forEach(function (perf) {
    var p = findPlayer_(snap, perf);
    if (!p) return;
    var r = scoreRound_(snap.votes[perf], optionsFor_(p).correct, perf, snap.state.notDone);
    Object.keys(r.points).forEach(function (n) { totals[n] = (totals[n] || 0) + r.points[n]; });
  });
  return Object.keys(totals)
    .map(function (n) { return { name: n, points: totals[n] }; })
    .sort(function (a, b) { return b.points - a.points || a.name.localeCompare(b.name); });
}

function getState_(voter) {
  var snap = snapshot_();
  var st = snap.state;
  var res = { phase: st.phase, round: st.round, total: st.order.length };
  if (st.phase === 'voting' || st.phase === 'reveal') {
    var perf = st.order[st.round];
    var player = findPlayer_(snap, perf);
    if (player) {
      var opts = optionsFor_(player);
      var votes = snap.votes[perf] || {};
      res.performer = perf;
      res.options = opts.texts;
      res.voted = Object.keys(votes).sort();
      res.eligible = Object.keys(snap.rsvp).filter(function (n) {
        return n !== perf && (snap.rsvp[n] === 'play' || snap.rsvp[n] === 'watch');
      }).length;
      if (voter) res.myVote = votes.hasOwnProperty(voter) ? votes[voter] : null;
      if (st.phase === 'reveal') {
        var r = scoreRound_(votes, opts.correct, perf, st.notDone);
        res.correct = opts.correct;
        res.byOption = [[], [], []];
        Object.keys(votes).sort().forEach(function (v) {
          if (res.byOption[votes[v]]) res.byOption[votes[v]].push(v);
        });
        res.roundPoints = r.points;
        res.notDone = st.notDone.indexOf(perf) >= 0;
      }
    }
  }
  if (st.phase === 'reveal' || st.phase === 'final') res.leaderboard = leaderboard_(snap);
  return res;
}

// ---------------------------------------------------------------- host controls

function admin_(cmd, p) {
  var snap = snapshot_();
  var st = snap.state;
  switch (cmd) {
    case 'start': {
      var order = snap.players
        .filter(function (pl) { return snap.rsvp[pl.name] === 'play'; })
        .map(function (pl) { return pl.name; });
      for (var i = order.length - 1; i > 0; i--) {
        var k = Math.floor(Math.random() * (i + 1));
        var t = order[i]; order[i] = order[k]; order[k] = t;
      }
      if (!order.length) throw new Error('Nobody has signed up to play yet');
      var vs = sheet_(SHEET.votes);
      if (vs.getLastRow() > 1) vs.getRange(2, 1, vs.getLastRow() - 1, vs.getLastColumn()).clearContent();
      st = { phase: 'voting', order: order, round: 0, revealed: [], notDone: [] };
      break;
    }
    case 'reveal': {
      if (st.phase !== 'voting') throw new Error('Nothing to reveal');
      var perf = st.order[st.round];
      if (st.revealed.indexOf(perf) < 0) st.revealed.push(perf);
      st.phase = 'reveal';
      break;
    }
    case 'reopen': {
      if (st.phase !== 'reveal') throw new Error('Round is not revealed');
      var cur = st.order[st.round];
      st.revealed = st.revealed.filter(function (n) { return n !== cur; });
      st.phase = 'voting';
      break;
    }
    case 'next': {
      if (st.phase !== 'reveal') throw new Error('Reveal this round first');
      if (st.round + 1 < st.order.length) {
        st.round += 1;
        st.phase = 'voting';
      } else {
        st.phase = 'final';
      }
      break;
    }
    case 'skip': {
      if (st.phase !== 'voting') throw new Error('Can only skip during voting');
      st.order.splice(st.round, 1);
      if (st.round >= st.order.length) st.phase = 'final';
      break;
    }
    case 'notDone': {
      var who = st.order[st.round];
      if (!who) throw new Error('No current player');
      var idx = st.notDone.indexOf(who);
      if (idx >= 0) st.notDone.splice(idx, 1); else st.notDone.push(who);
      break;
    }
    case 'final':
      st.phase = 'final';
      break;
    case 'lobby':
      st.phase = 'lobby';
      break;
    default:
      throw new Error('Unknown command');
  }
  writeState_(st);
  return getState_(null);
}
