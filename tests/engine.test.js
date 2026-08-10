const assert = require('assert');
const Engine = require('../padel-engine.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok - ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL - ' + name);
    console.log('    ' + err.message);
  }
}

function playPoints(state, teams) {
  let s = state;
  let lastInfo = null;
  for (const t of teams) {
    const r = Engine.applyPointWithInfo(s, t);
    s = r.state;
    lastInfo = r.info;
  }
  return { state: s, info: lastInfo };
}

console.log('Normal game / deuce / advantage');
test('wins a game at 4 points to love', () => {
  const s0 = Engine.createInitialState();
  const { state, info } = playPoints(s0, ['a', 'a', 'a', 'a']);
  assert.strictEqual(state.games.a, 1);
  assert.strictEqual(state.pts.a, 0);
  assert.strictEqual(info.gameWon, 'a');
});
test('reaches deuce at 40-40 then advantage then game', () => {
  const s0 = Engine.createInitialState();
  let { state } = playPoints(s0, ['a', 'a', 'a', 'b', 'b', 'b']);
  assert.strictEqual(state.pts.a, 40);
  assert.strictEqual(state.pts.b, 40);
  let r = Engine.applyPointWithInfo(state, 'a');
  assert.strictEqual(r.state.pts.a, 'AD');
  r = Engine.applyPointWithInfo(r.state, 'b'); // back to deuce
  assert.strictEqual(r.state.pts.a, 40);
  assert.strictEqual(r.state.pts.b, 40);
  r = Engine.applyPointWithInfo(r.state, 'a');
  r = Engine.applyPointWithInfo(r.state, 'a'); // AD then win
  assert.strictEqual(r.state.games.a, 1);
  assert.strictEqual(r.info.gameWon, 'a');
});

console.log('Sets');
function winGameFor(state, team) {
  const need = SEQ_LEN_FOR(state, team);
  let s = state;
  for (let i = 0; i < need; i++) s = Engine.applyPointWithInfo(s, team).state;
  return s;
}
function SEQ_LEN_FOR() { return 4; } // simplest path to a game win from love-love, no deuce

test('wins a set 6-4', () => {
  let s = Engine.createInitialState();
  for (let g = 0; g < 4; g++) s = winGameFor(s, 'b'); // b: 4 games
  for (let g = 0; g < 6; g++) s = winGameFor(s, 'a'); // a: 6 games
  assert.strictEqual(s.sets.a, 1);
  assert.strictEqual(s.games.a, 0);
  assert.strictEqual(s.games.b, 0);
  assert.strictEqual(s.setHistory.length, 1);
  assert.deepStrictEqual(s.setHistory[0].a, 6);
  assert.deepStrictEqual(s.setHistory[0].b, 4);
});
test('wins a set 7-5', () => {
  let s = Engine.createInitialState();
  for (let g = 0; g < 5; g++) s = winGameFor(s, 'b');
  for (let g = 0; g < 7; g++) s = winGameFor(s, 'a');
  assert.strictEqual(s.sets.a, 1);
  assert.strictEqual(s.setHistory[0].a, 7);
  assert.strictEqual(s.setHistory[0].b, 5);
});

console.log('Tiebreaks — including the deciding set (no more 5-5 breaker)');
test('reaches a 6-6 tiebreak in a normal set', () => {
  let s = Engine.createInitialState();
  for (let g = 0; g < 6; g++) { s = winGameFor(s, 'a'); s = winGameFor(s, 'b'); }
  assert.strictEqual(s.tiebreak, true);
  assert.strictEqual(s.games.a, 6);
  assert.strictEqual(s.games.b, 6);
});
test('deciding set (1 set each) also goes to a 6-6 tiebreak, not 5-5', () => {
  let s = Engine.createInitialState();
  // Team A wins set 1 6-0, Team B wins set 2 6-0 → 1-1 in sets, decider begins
  for (let g = 0; g < 6; g++) s = winGameFor(s, 'a');
  for (let g = 0; g < 6; g++) s = winGameFor(s, 'b');
  assert.strictEqual(s.sets.a, 1);
  assert.strictEqual(s.sets.b, 1);
  // Now play the decider to 5-5 (interleaved, to avoid an early set win) and confirm NO tiebreak yet
  for (let g = 0; g < 5; g++) { s = winGameFor(s, 'a'); s = winGameFor(s, 'b'); }
  assert.strictEqual(s.tiebreak, false, 'must not enter a tiebreak at 5-5 in the decider');
  assert.strictEqual(s.games.a, 5);
  assert.strictEqual(s.games.b, 5);
  // Continue to 6-6 — tiebreak should start here instead
  s = winGameFor(s, 'a');
  s = winGameFor(s, 'b');
  assert.strictEqual(s.tiebreak, true, 'decider set must enter tiebreak at 6-6, same as any set');
});
test('wins a tiebreak 7-5 and thereby the set/match', () => {
  let s = Engine.createInitialState({ setsToWin: 1 });
  for (let g = 0; g < 6; g++) { s = winGameFor(s, 'a'); s = winGameFor(s, 'b'); }
  assert.strictEqual(s.tiebreak, true);
  for (let i = 0; i < 5; i++) s = Engine.applyPointWithInfo(s, 'b').state; // b: 5
  let r;
  for (let i = 0; i < 6; i++) { r = Engine.applyPointWithInfo(s, 'a'); s = r.state; } // a: 6 (6-5, not won yet — margin 1)
  assert.strictEqual(r.info.gameWon, null);
  r = Engine.applyPointWithInfo(s, 'a'); // a: 7 (7-5, margin 2 — wins)
  s = r.state;
  assert.strictEqual(s.matchOver, true);
  assert.strictEqual(s.winner, 'a');
  assert.strictEqual(s.setHistory[s.setHistory.length - 1].a, 7);
});
test('extended tiebreak requires a 2-point margin past 7 (e.g. 10-8)', () => {
  let s = Engine.createInitialState();
  for (let g = 0; g < 6; g++) { s = winGameFor(s, 'a'); s = winGameFor(s, 'b'); }
  // Drive to 6-6 in the tiebreak
  for (let i = 0; i < 6; i++) { s = Engine.applyPointWithInfo(s, 'a').state; s = Engine.applyPointWithInfo(s, 'b').state; }
  assert.strictEqual(s.pts.a, 6);
  assert.strictEqual(s.pts.b, 6);
  let r = Engine.applyPointWithInfo(s, 'a');
  assert.strictEqual(r.info.gameWon, null, '7-6 must not win — needs a 2-point margin');
  s = r.state;
  s = Engine.applyPointWithInfo(s, 'b').state; // 7-7
  s = Engine.applyPointWithInfo(s, 'a').state; // 8-7
  r = Engine.applyPointWithInfo(s, 'a'); // 9-7 -> not enough margin over 7? actually 9-7 margin=2 -> wins
  assert.strictEqual(r.info.gameWon, 'a');
});

console.log('Serve rotation');
test('serve advances one slot per game, cycling through 4 slots', () => {
  let s = Engine.createInitialState({ servingActive: true });
  assert.strictEqual(s.serverIndex, 0);
  s = winGameFor(s, 'a');
  assert.strictEqual(s.serverIndex, 1);
  s = winGameFor(s, 'b');
  assert.strictEqual(s.serverIndex, 2);
  s = winGameFor(s, 'a');
  assert.strictEqual(s.serverIndex, 3);
  s = winGameFor(s, 'b');
  assert.strictEqual(s.serverIndex, 0);
});
test('tiebreak: first server plays one point, then alternates every two', () => {
  let s = Engine.createInitialState({ servingActive: true });
  for (let g = 0; g < 6; g++) { s = winGameFor(s, 'a'); s = winGameFor(s, 'b'); }
  const startServer = s.tbStartServerIndex;
  assert.strictEqual(s.serverIndex, startServer, 'server unchanged the instant the tiebreak begins');
  // serverIndex always reflects who serves the UPCOMING point.
  let r = Engine.applyPointWithInfo(s, 'a'); // point 1 played by startServer; point 2 is next server
  assert.strictEqual(r.state.serverIndex, (startServer + 1) % 4);
  r = Engine.applyPointWithInfo(r.state, 'a'); // point 2 played; point 3 same server (pair)
  assert.strictEqual(r.state.serverIndex, (startServer + 1) % 4);
  r = Engine.applyPointWithInfo(r.state, 'a'); // point 3 played; point 4 moves to next server
  assert.strictEqual(r.state.serverIndex, (startServer + 2) % 4);
  r = Engine.applyPointWithInfo(r.state, 'a'); // point 4 played; point 5 same server (pair)
  assert.strictEqual(r.state.serverIndex, (startServer + 2) % 4);
});
test('after a tiebreak, serve resumes as if the tiebreak were one game in the rotation', () => {
  let s = Engine.createInitialState({ servingActive: true });
  for (let g = 0; g < 6; g++) { s = winGameFor(s, 'a'); s = winGameFor(s, 'b'); }
  const tbStart = s.tbStartServerIndex;
  for (let i = 0; i < 6; i++) { s = Engine.applyPointWithInfo(s, 'a').state; }
  s = Engine.applyPointWithInfo(s, 'a').state; // 7-0, wins tiebreak
  assert.strictEqual(s.tiebreak, false);
  assert.strictEqual(s.serverIndex, (tbStart + 1) % 4);
});

console.log('Change of ends — 1st/3rd/5th game of each set, resets per set, and tiebreak mid-points');
test('changes ends after game 1, not game 2, changes after game 3', () => {
  let s = Engine.createInitialState();
  let r = Engine.applyPointWithInfo(s, 'a');
  for (let i = 0; i < 3; i++) r = Engine.applyPointWithInfo(r.state, 'a');
  assert.strictEqual(r.info.gameWon, 'a');
  assert.strictEqual(r.info.changeEnds, true, 'must change ends after game 1');
  s = r.state;
  r = winGameFor4(s, 'b');
  assert.strictEqual(r.info.changeEnds, false, 'must NOT change ends after game 2');
  s = r.state;
  r = winGameFor4(s, 'a');
  assert.strictEqual(r.info.changeEnds, true, 'must change ends after game 3');
});
function winGameFor4(state, team) {
  let s = state, info = null;
  for (let i = 0; i < 4; i++) { const r = Engine.applyPointWithInfo(s, team); s = r.state; info = r.info; }
  return { state: s, info };
}
test('gamesInSet resets at the start of a new set', () => {
  let s = Engine.createInitialState();
  for (let g = 0; g < 6; g++) s = winGameFor(s, 'a');
  // Set won on an even game count in the set is possible (6 games) — gamesInSet should reset to 0
  assert.strictEqual(s.gamesInSet, 0);
  const r = winGameFor4(s, 'a');
  assert.strictEqual(r.info.changeEnds, true, 'first game of the new set should change ends again');
});
test('tiebreak changes ends every 6 combined points', () => {
  let s = Engine.createInitialState();
  for (let g = 0; g < 6; g++) { s = winGameFor(s, 'a'); s = winGameFor(s, 'b'); }
  let r;
  for (let i = 0; i < 5; i++) { r = Engine.applyPointWithInfo(s, 'a'); s = r.state; assert.strictEqual(r.info.changeEnds, false); }
  r = Engine.applyPointWithInfo(s, 'b'); // combined total = 6
  assert.strictEqual(r.info.changeEnds, true, 'must change ends when combined tiebreak points hits 6');
});
test('does not double-fire change-of-ends when the tiebreak finishes exactly on a 6-point boundary', () => {
  let s = Engine.createInitialState();
  for (let g = 0; g < 6; g++) { s = winGameFor(s, 'a'); s = winGameFor(s, 'b'); }
  // Drive to 7-5 (12 combined points, a multiple of 6) as the finishing point
  for (let i = 0; i < 5; i++) { s = Engine.applyPointWithInfo(s, 'a').state; s = Engine.applyPointWithInfo(s, 'b').state; }
  s = Engine.applyPointWithInfo(s, 'a').state; // 6-5
  const r = Engine.applyPointWithInfo(s, 'a'); // 7-5 — wins, AND combined=12 (mult of 6)
  assert.strictEqual(r.info.gameWon, 'a');
  assert.strictEqual(r.info.changeEnds, true, 'still a real change-of-ends, but from the game-won path, not double-applied');
  // The key correctness property: changeEnds is a single boolean, not a count — verify it's exactly true, not somehow inconsistent.
  assert.strictEqual(typeof r.info.changeEnds, 'boolean');
});

console.log('Undo via replay (removing the last point event)');
test('replaying without the last point event reverts state exactly', () => {
  const checkpoint = Engine.createInitialState();
  const points = [{ team: 'a' }, { team: 'a' }, { team: 'b' }, { team: 'a' }];
  const full = Engine.replay(checkpoint, points);
  const withoutLast = Engine.replay(checkpoint, points.slice(0, -1));
  assert.strictEqual(full.pts.a, 40);
  assert.strictEqual(withoutLast.pts.a, 30);
});
test('undoing a match-winning point un-completes the match', () => {
  const checkpoint = Engine.createInitialState({ setsToWin: 1 });
  const points = [];
  for (let g = 0; g < 5; g++) for (let i = 0; i < 4; i++) points.push({ team: 'a' });
  const before = Engine.replay(checkpoint, points);
  assert.strictEqual(before.matchOver, false);
  points.push({ team: 'a' }, { team: 'a' }, { team: 'a' }, { team: 'a' }); // wins game 6, the set, the match
  const afterWin = Engine.replay(checkpoint, points);
  assert.strictEqual(afterWin.matchOver, true);
  const afterUndo = Engine.replay(checkpoint, points.slice(0, -1));
  assert.strictEqual(afterUndo.matchOver, false);
});

console.log('Match completion (best of 3)');
test('match completes after winning 2 sets', () => {
  let s = Engine.createInitialState({ setsToWin: 2 });
  for (let set = 0; set < 2; set++) {
    for (let g = 0; g < 6; g++) s = winGameFor(s, 'a');
  }
  assert.strictEqual(s.matchOver, true);
  assert.strictEqual(s.winner, 'a');
  assert.strictEqual(s.sets.a, 2);
});
test('does not add points once the match is over', () => {
  let s = Engine.createInitialState({ setsToWin: 1 });
  for (let g = 0; g < 6; g++) s = winGameFor(s, 'a');
  assert.strictEqual(s.matchOver, true);
  const before = Engine.clone(s);
  const r = Engine.applyPointWithInfo(s, 'b');
  assert.deepStrictEqual(r.state.pts, before.pts);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
