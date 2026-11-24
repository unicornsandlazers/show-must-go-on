(function () {
  const LETTERS = ['A', 'B', 'C'];
  const stage = document.getElementById('stage');
  const controls = document.getElementById('controls');
  const key = new URLSearchParams(location.search).get('key') || '';

  let init = null;
  let game = null;
  let lastJson = '';
  let busy = false;
  let armed = null;       // command waiting for a second click to confirm
  let pollTimer = null;

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 3500);
  }

  function siteUrl() {
    return location.origin + location.pathname.replace(/tv\.html$/, '');
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // ------------------------------------------------------------ stage views
  function lobbyView() {
    const rsvp = (init && init.rsvp) || {};
    const playing = Object.keys(rsvp).filter((n) => rsvp[n] === 'play').sort();
    const watching = Object.keys(rsvp).filter((n) => rsvp[n] === 'watch').sort();
    let qr = '';
    try {
      const q = qrcode(0, 'M');
      q.addData(siteUrl());
      q.make();
      qr = q.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
    } catch (e) { qr = ''; }
    return (
      '<div class="lobby">' +
      '<div style="display:grid;gap:3vh">' +
      '<p class="eyebrow">Tonight on stage</p>' +
      '<h1>' + esc((init && init.config.title) || 'The Show Must Go On') + '</h1>' +
      '<p class="lead">Grab your phone, scan the code and pick your name. Voting starts soon.</p>' +
      '<p class="lead muted">' + plural(playing.length, 'player', 'players') + ' · ' + plural(watching.length, 'spectator', 'spectators') + '</p>' +
      '<div class="chips">' + playing.map((n) => '<span class="chip on">' + esc(n) + '</span>').join('') +
      watching.map((n) => '<span class="chip">' + esc(n) + '</span>').join('') + '</div>' +
      '</div>' +
      '<div style="display:grid;gap:12px;justify-items:center"><div class="qr">' + qr + '</div><div class="url">' + esc(siteUrl()) + '</div></div>' +
      '</div>'
    );
  }

  function optionCards(g, reveal) {
    return '<div class="opts">' + g.options.map((t, i) => {
      let cls = 'opt';
      if (reveal) cls += i === g.correct ? ' correct' : ' dim';
      const who = reveal ? g.byOption[i] : null;
      return '<div class="' + cls + '"><span class="letter">' + LETTERS[i] + '</span><span>' + esc(t) + '</span>' +
        (who ? '<span class="who">' + (who.length ? esc(who.join(', ')) : 'No votes') + '</span>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function miniBoard(board, highlight) {
    return '<table class="board">' + board.slice(0, 6).map((r, i) =>
      '<tr' + (highlight && highlight[r.name] ? ' class="me"' : '') + '><td>' + (i + 1) + '. ' + esc(r.name) +
      (highlight && highlight[r.name] ? ' <span class="small">+' + highlight[r.name] + '</span>' : '') +
      '</td><td>' + r.points + '</td></tr>').join('') + '</table>';
  }

  function votingView(g) {
    return (
      '<p class="eyebrow">Round ' + (g.round + 1) + ' of ' + g.total + '</p>' +
      '<h2>What was ' + esc(g.performer) + '\'s real mission?</h2>' +
      optionCards(g, false) +
      '<p class="lead"><strong>' + g.voted.length + '</strong> of ' + g.eligible + ' have voted</p>' +
      '<div class="chips">' + g.voted.map((n) => '<span class="chip on">' + esc(n) + '</span>').join('') + '</div>'
    );
  }

  function revealView(g) {
    const right = g.byOption[g.correct].length;
    const total = g.voted.length;
    const fooled = total - right;
    let verdict;
    if (total === 0) verdict = 'Nobody voted. No points.';
    else if (right === 0) verdict = 'Nobody guessed it! Too subtle, so no points for anyone.';
    else if (right === total) verdict = 'Everyone saw right through ' + esc(g.performer) + '! +1 for each guesser.';
    else if (g.notDone) verdict = esc(g.performer) + ' skipped the mission: no points for fooling. Right guessers +2.';
    else verdict = esc(g.performer) + ' fooled ' + plural(fooled, 'person', 'people') + ': +' + fooled + '! Right guessers +2.';
    return (
      '<p class="eyebrow">Round ' + (g.round + 1) + ' of ' + g.total + '</p>' +
      '<h2>' + esc(g.performer) + '\'s real mission was…</h2>' +
      optionCards(g, true) +
      '<div class="split">' +
      '<p class="verdict">' + verdict + '</p>' +
      '<div><p class="eyebrow">Leaderboard</p>' + miniBoard(g.leaderboard || [], g.roundPoints) + '</div>' +
      '</div>'
    );
  }

  function winnerLine(b) {
    if (!b.length) return 'That\'s a wrap!';
    const top = b.filter((r) => r.points === b[0].points).map((r) => esc(r.name));
    if (top.length === 1) return 'And the winner is ' + top[0] + '!';
    return 'It\'s a tie: ' + top.slice(0, -1).join(', ') + ' & ' + top[top.length - 1] + '!';
  }

  function finalView(g) {
    const b = g.leaderboard || [];
    const step = (r, cls, place) => r
      ? '<div class="step ' + cls + '"><div class="eyebrow">#' + place + '</div><div class="nm">' + esc(r.name) + '</div><div class="pt">' + r.points + ' points</div></div>'
      : '<div></div>';
    return (
      '<p class="eyebrow">Final curtain</p>' +
      '<h1>' + winnerLine(b) + '</h1>' +
      '<div class="podium">' + step(b[1], 'p2', 2) + step(b[0], 'p1', 1) + step(b[2], 'p3', 3) + '</div>' +
      (b.length > 3
        ? '<div class="rest">' + b.slice(3).map((r, i) =>
            '<div><span>' + (i + 4) + '. ' + esc(r.name) + '</span><strong>' + r.points + '</strong></div>').join('') + '</div>'
        : '')
    );
  }

  function renderStage() {
    const g = game;
    if (!g) return;
    if (g.phase === 'lobby') stage.innerHTML = lobbyView();
    else if (g.phase === 'voting') stage.innerHTML = votingView(g);
    else if (g.phase === 'reveal') stage.innerHTML = revealView(g);
    else if (g.phase === 'final') stage.innerHTML = finalView(g);
  }

  // ------------------------------------------------------------ host controls
  function btn(cmd, label, primary) {
    const confirm = armed === cmd;
    return '<button class="btn' + (primary ? ' primary' : '') + '" data-cmd="' + cmd + '">' +
      (confirm ? 'Click again to confirm' : label) + '</button>';
  }

  function renderControls() {
    if (!key) {
      controls.innerHTML = '<span class="error">Add ?key=YOUR_ADMIN_KEY to the address to control the game.</span>';
      return;
    }
    const g = game || { phase: 'lobby' };
    let html = '<span class="eyebrow">Host</span>';
    if (g.phase === 'lobby') {
      html += btn('start', 'Start the vote', true);
    } else if (g.phase === 'voting') {
      html += btn('reveal', 'Reveal', true) + btn('skip', 'Skip this player') ;
    } else if (g.phase === 'reveal') {
      const last = g.round + 1 >= g.total;
      html += btn('next', last ? 'Show final results' : 'Next player', true) +
        btn('notDone', g.notDone ? 'Mission was done after all' : 'Mission not done') +
        btn('reopen', 'Undo reveal');
    } else if (g.phase === 'final') {
      html += btn('lobby', 'Back to lobby');
    }
    html += '<span class="spacer"></span><button class="linkish" data-act="hidebar">Hide bar (H)</button>';
    controls.innerHTML = html;
  }

  const NEEDS_CONFIRM = { start: true, skip: true, lobby: true };

  controls.addEventListener('click', async (e) => {
    const el = e.target.closest('button');
    if (!el || busy) return;
    if (el.dataset.act === 'hidebar') { controls.classList.toggle('hidden-bar'); return; }
    const cmd = el.dataset.cmd;
    if (!cmd) return;
    if (NEEDS_CONFIRM[cmd] && armed !== cmd) {
      armed = cmd;
      renderControls();
      setTimeout(() => { if (armed === cmd) { armed = null; renderControls(); } }, 4000);
      return;
    }
    armed = null;
    busy = true;
    el.disabled = true;
    try {
      game = await API.call('admin', { key: key, cmd: cmd });
      lastJson = JSON.stringify(game);
      renderStage();
    } catch (err) {
      toast(err.message);
    }
    busy = false;
    renderControls();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') controls.classList.toggle('hidden-bar');
  });

  // ------------------------------------------------------------ polling
  async function poll() {
    clearTimeout(pollTimer);
    try {
      const g = await API.call('state', {});
      if (g.phase === 'lobby') init = await API.call('init');
      const json = JSON.stringify(g) + (g.phase === 'lobby' ? JSON.stringify(init && init.rsvp) : '');
      if (json !== lastJson && !busy) {
        lastJson = json;
        game = g;
        renderStage();
        renderControls();
      }
    } catch (err) {
      if (!game) stage.innerHTML = '<h2>Stage fright</h2><p class="lead error">' + esc(err.message) + '</p>';
    }
    pollTimer = setTimeout(poll, game && game.phase === 'lobby' ? 5000 : 2000);
  }

  renderControls();
  poll();
})();
