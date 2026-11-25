(function () {
  const NAME_KEY = 'smgo-name';
  const LETTERS = ['A', 'B', 'C'];
  const app = document.getElementById('app');

  let init = null;          // { config, names, rsvp, phase }
  let me = store.get(NAME_KEY);
  let missions = null;      // { real, decoys } for `me`
  let missionsShown = false;
  let game = null;          // latest state from the server
  let busy = false;
  let lastGameJson = '';
  let pollTimer = null;

  // ------------------------------------------------------------ helpers
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 3200);
  }

  function phase() {
    return (game && game.phase) || (init && init.phase) || 'lobby';
  }

  function host() {
    return (init && init.config.host) || 'The host';
  }

  function myStatus() {
    return (init && init.rsvp && init.rsvp[me]) || null;
  }

  function header() {
    const c = init.config;
    document.getElementById('title').innerHTML = logoHtml(c.title);
    if (c.title) document.title = c.title;
    document.getElementById('when').textContent = [c.date, c.time].filter(Boolean).join(' · ');
    document.getElementById('where').textContent = c.address || '';
  }

  function switchLink() {
    return '<button class="linkish" data-act="switch">Not ' + esc(me) + '? Pick another name</button>';
  }

  // ------------------------------------------------------------ views
  function renderPicker() {
    const names = init.names;
    const rsvp = init.rsvp || {};
    const answered = names.filter((n) => rsvp[n]);
    const button = (n) => {
      const s = rsvp[n];
      if (!s) return '<button class="btn" data-pick="' + esc(n) + '">' + esc(n) + '</button>';
      const label = s === 'no' ? 'Answered' : '\u2713 Coming';
      return '<button class="btn answered" data-pick="' + esc(n) + '">' + esc(n) +
        '<span class="tag' + (s === 'no' ? ' no' : '') + '">' + label + '</span></button>';
    };
    let list = '';
    if (!names.length) {
      list = '<p class="muted">The guest list is still empty.</p>';
    } else {
      // One alphabetical list: answered names are greyed out in place.
      list = '<div class="names">' + names.map(button).join('') + '</div>';
    }
    app.innerHTML =
      '<section class="card">' +
      '<p class="eyebrow">You are invited</p>' +
      '<h2>Who are you?</h2>' +
      '<p class="muted">Pick your name to answer the invite.' +
      (answered.length ? ' Already answered? Tap your name again to see your missions or change your answer.' : '') +
      '</p>' + list +
      '</section>';
  }

  function rulesCard(status) {
    const watch = status === 'watch';
    return (
      '<section class="card">' +
      '<p class="eyebrow">The game</p>' +
      '<h2>How it works</h2>' +
      (watch
        ? '<p>You have no mission, but you can still vote along and win points for good guesses.</p>'
        : '') +
      '<ol class="rules">' +
      '<li>During the party, every player secretly completes their <strong>real mission</strong> without getting caught. Tell nobody, not even your partner.</li>' +
      '<li>Players may also fake their <strong>decoys</strong> to throw everyone off.</li>' +
      '<li>Later in the evening we vote on each player from our phones: which of three missions was the real one?</li>' +
      '</ol>' +
      '<div class="points">' +
      '<p class="eyebrow">Points</p>' +
      '<p><strong>Some guess right:</strong> each of them gets +2, and the player gets +1 for every person they fooled.</p>' +
      '<p><strong>Everyone guesses right:</strong> each guesser gets +1, the player gets 0. Too obvious!</p>' +
      '<p><strong>Nobody guesses right:</strong> nobody scores. Too subtle, or was the mission even done?</p>' +
      '<p class="muted small">' + esc(host()) + ' knows every mission and keeps an eye on you. Skip yours, and you get no points for fooling people. Most points at the end wins.</p>' +
      '</div>' +
      '</section>'
    );
  }

  function missionsCard() {
    const shown = missionsShown && missions;
    const content = missions
      ? '<div><p class="eyebrow">Your real mission</p><div class="real">' + esc(missions.real) + '</div></div>' +
        '<div style="display:grid;gap:8px"><p class="eyebrow">Your decoys</p>' +
        '<p class="muted small">These appear next to your name in the vote as fake answers. You don\'t have to do them, but faking them now and then makes you harder to read.</p>' +
        missions.decoys.map((d) => '<div class="decoy">' + esc(d) + '</div>').join('') + '</div>'
      : '<div><p class="eyebrow">Your real mission</p><div class="real">Nice try. Nothing to see here yet, it is a secret.</div></div>' +
        '<div class="decoy">Decoy number one is hiding here.</div><div class="decoy">Decoy number two is hiding here.</div>';
    return (
      '<section class="card missions' + (shown ? '' : ' hidden') + '">' +
      '<p class="eyebrow">Top secret</p>' +
      '<h2>Your missions</h2>' +
      '<div class="content">' + content + '</div>' +
      (shown
        ? '<button class="linkish" data-act="hide">Hide them again</button>'
        : '<div class="cover"><button class="btn primary" data-act="show">Show my missions</button></div>') +
      '</section>'
    );
  }

  function renderInvite() {
    const status = myStatus();
    const opt = (value, title, sub) =>
      '<button class="choice' + (status === value ? ' selected' : '') + '" data-rsvp="' + value + '">' +
      '<strong>' + title + '</strong><span>' + sub + '</span></button>';
    let html =
      '<section class="card">' +
      '<p class="eyebrow">You are invited</p>' +
      '<h2>Hi ' + esc(me) + '!</h2>' +
      (init.config.note ? '<p>' + esc(init.config.note) + '</p>' : '') +
      '<p class="muted">Will you join the party?</p>' +
      '<div class="choices">' +
      opt('play', 'I\'m coming, and I\'m playing', 'Give me a secret mission.') +
      opt('watch', 'I\'m coming, but I\'d rather not play', 'No mission for me. I can still vote along.') +
      opt('no', 'I can\'t make it', 'Sadly not this time.') +
      '</div>' +
      (status === 'no' ? '<p class="muted">We\'ll miss you! You can change your answer here any time.</p>' : '') +
      switchLink() +
      '</section>';
    if (status === 'play') html += missionsCard();
    if (status === 'play' || status === 'watch') html += rulesCard(status);
    app.innerHTML = html;
  }

  function optionsList(g, mode) {
    // mode: 'vote' | 'view' | 'reveal'
    return '<div class="choices">' + g.options.map((text, i) => {
      let cls = 'vote-option';
      if (mode === 'vote' && g.myVote === i) cls += ' selected';
      if (mode === 'reveal') cls += i === g.correct ? ' correct' : ' dim';
      if (mode === 'reveal' && g.myVote === i && i !== g.correct) cls += ' selected';
      const who = mode === 'reveal' && g.byOption ? g.byOption[i] : null;
      const inner =
        '<span class="letter">' + LETTERS[i] + '</span>' +
        '<span><span>' + esc(text) + '</span>' +
        (who ? '<br><span class="muted small">' + (who.length ? esc(who.join(', ')) : 'No votes') + '</span>' : '') +
        '</span>';
      return mode === 'vote'
        ? '<button class="' + cls + '" data-vote="' + i + '">' + inner + '</button>'
        : '<div class="' + cls + '">' + inner + '</div>';
    }).join('') + '</div>';
  }

  function roundLabel(g) {
    return '<p class="eyebrow">Round ' + (g.round + 1) + ' of ' + g.total + '</p>';
  }

  function myTotal(g) {
    const row = (g.leaderboard || []).find((r) => r.name === me);
    return row ? row.points : 0;
  }

  function renderGame() {
    const g = game;
    if (!g) { app.innerHTML = '<section class="card"><p class="muted">Loading the game…</p></section>'; return; }

    if (g.phase === 'voting') {
      const count = '<p class="muted small">' + g.voted.length + ' of ' + g.eligible + ' have voted</p>';
      if (g.performer === me) {
        app.innerHTML =
          '<section class="card">' + roundLabel(g) +
          '<h2>You\'re on stage!</h2>' +
          '<p>Everyone is guessing your real mission right now. Keep a straight face.</p>' +
          optionsList(g, 'view') + count + '</section>';
      } else {
        app.innerHTML =
          '<section class="card">' + roundLabel(g) +
          '<h2>What was ' + esc(g.performer) + '\'s real mission?</h2>' +
          optionsList(g, 'vote') +
          '<p class="' + (g.myVote == null ? 'muted' : '') + '">' +
          (g.myVote == null ? 'Tap the mission you think is real.' : 'Vote saved. You can change it until the reveal.') +
          '</p>' + count + '</section>';
      }
      return;
    }

    if (g.phase === 'reveal') {
      const pts = (g.roundPoints && g.roundPoints[me]) || 0;
      let verdict;
      if (g.performer === me) {
        const fooled = g.voted.length - g.byOption[g.correct].length;
        if (g.notDone) verdict = 'Mission not completed, so no points for fooling people.';
        else if (pts > 0) verdict = 'You fooled ' + fooled + (fooled === 1 ? ' person' : ' people') + '! +' + pts;
        else if (g.voted.length && fooled === 0) verdict = 'Everyone saw right through you. 0 points.';
        else verdict = 'Nobody figured you out. Too subtle! 0 points.';
      } else if (g.myVote == null) {
        verdict = 'You didn\'t vote this round.';
      } else if (g.myVote === g.correct) {
        verdict = 'You got it! +' + pts;
      } else {
        verdict = 'Fooled you! No points this round.';
      }
      app.innerHTML =
        '<section class="card">' + roundLabel(g) +
        '<h2>' + esc(g.performer) + '\'s real mission was…</h2>' +
        optionsList(g, 'reveal') +
        '<p><strong>' + esc(verdict) + '</strong></p>' +
        '<p class="muted small">Your total: ' + myTotal(g) + ' points</p>' +
        '</section>';
      return;
    }

    if (g.phase === 'final') {
      const board = g.leaderboard || [];
      const rank = board.findIndex((r) => r.name === me);
      const winner = board[0];
      const tied = winner ? board.filter((r) => r.points === winner.points).map((r) => r.name) : [];
      app.innerHTML =
        '<section class="card">' +
        '<p class="eyebrow">Final curtain</p>' +
        '<h2>' + (winner ? (tied.length > 1 ? 'It\'s a tie: ' + esc(tied.join(', ')) + '!' : 'And the winner is ' + esc(winner.name) + '!') : 'That\'s a wrap!') + '</h2>' +
        (rank >= 0 ? '<p>You finished <strong>#' + (rank + 1) + '</strong> with ' + board[rank].points + ' points.</p>' : '') +
        '<table class="board">' + board.map((r, i) =>
          '<tr' + (r.name === me ? ' class="me"' : '') + '><td>' + (i + 1) + '. ' + esc(r.name) + '</td><td>' + r.points + '</td></tr>'
        ).join('') + '</table>' +
        '</section>';
    }
  }

  function render() {
    if (!init) return;
    header();
    if (!me || init.names.indexOf(me) < 0) { me = null; renderPicker(); return; }
    if (phase() === 'lobby') renderInvite(); else renderGame();
  }

  // ------------------------------------------------------------ actions
  app.addEventListener('click', async (e) => {
    const el = e.target.closest('button');
    if (!el || busy) return;

    if (el.dataset.pick) {
      me = el.dataset.pick;
      store.set(NAME_KEY, me);
      missions = null;
      missionsShown = false;
      render();
      poll(true);
      window.scrollTo(0, 0);
      return;
    }

    const act = el.dataset.act;
    if (act === 'switch') {
      me = null;
      store.del(NAME_KEY);
      missions = null;
      missionsShown = false;
      render();
      return;
    }
    if (act === 'hide') { missionsShown = false; render(); return; }
    if (act === 'show') {
      busy = true;
      el.disabled = true;
      el.textContent = 'Opening the envelope…';
      try {
        if (!missions) missions = await API.call('missions', { name: me });
        missionsShown = true;
      } catch (err) {
        toast(err.message);
      }
      busy = false;
      render();
      return;
    }

    if (el.dataset.rsvp) {
      const status = el.dataset.rsvp;
      busy = true;
      try {
        await API.call('rsvp', { name: me, status: status });
        init.rsvp[me] = status;
        toast(status === 'no' ? 'Got it. Thanks for letting us know.' : 'See you there!');
      } catch (err) {
        toast(err.message);
      }
      busy = false;
      render();
      return;
    }

    if (el.dataset.vote !== undefined && game && game.phase === 'voting') {
      const choice = Number(el.dataset.vote);
      const prev = game.myVote;
      game.myVote = choice;          // show the choice straight away
      renderGame();
      busy = true;
      try {
        await API.call('vote', { voter: me, performer: game.performer, choice: choice });
      } catch (err) {
        game.myVote = prev;
        toast(err.message);
      }
      busy = false;
      poll(true);
    }
  });

  // ------------------------------------------------------------ polling
  async function poll(now) {
    clearTimeout(pollTimer);
    if (!now) {
      try {
        const g = await API.call('state', { voter: me || '' });
        const before = phase();
        game = g;
        const json = JSON.stringify(g);
        if (g.phase !== before) {
          lastGameJson = json;
          if (g.phase === 'lobby') await refreshInit();
          render();
        } else if (g.phase !== 'lobby' && json !== lastGameJson && !busy) {
          lastGameJson = json;
          render();
        }
      } catch (err) {
        // keep polling quietly; the next try usually works
      }
    }
    const delay = phase() === 'lobby' ? 10000 : 2500;
    pollTimer = setTimeout(() => poll(false), now ? 300 : delay);
  }

  async function refreshInit() {
    init = await API.call('init');
  }

  async function start() {
    try {
      await refreshInit();
    } catch (err) {
      app.innerHTML = '<section class="card"><h2>The curtain is stuck</h2><p class="error">' + esc(err.message) + '</p>' +
        '<button class="btn" onclick="location.reload()">Try again</button></section>';
      return;
    }
    render();
    poll(phase() === 'lobby' ? false : true);
  }

  start();
})();
