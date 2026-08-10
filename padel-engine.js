/**
 * Padel Scoring Engine — pure functions only.
 *
 * No DOM access, no Firebase, no speechSynthesis. Given a state and an action,
 * returns a new state (plus, for point-scoring, a small "info" object describing
 * what just happened, e.g. for the UI/voice layer to decide what to announce).
 *
 * Rules implemented:
 *  - Standard 0/15/30/40 + deuce/advantage scoring.
 *  - Sets first to 6 games, win by 2, up to 7 (7-5); at 6-6 → tiebreak.
 *    (No separate 5-5 "decider set" tiebreak — every set, including a deciding
 *    set, plays a normal 6-6 tiebreak. This matches standard singles/doubles play.)
 *  - Tiebreak: first to 7 points, win by 2, no cap.
 *  - Serve rotation: fixed 4-slot rotation for doubles; during a tiebreak, the
 *    starting server plays one point, then serve alternates every two points,
 *    continuing the same 4-slot rotation.
 *  - Change of ends: after the 1st, 3rd, 5th, ... game of each set (the count
 *    resets at the start of every new set). During a tiebreak, ends also change
 *    every 6 combined points — but not "twice" if the tiebreak (and therefore
 *    the set) happens to finish exactly on a 6-point boundary; the end-of-set
 *    change of ends takes precedence on that point instead.
 *
 * Usable both from a browser (`<script src="padel-engine.js"></script>` exposes
 * `window.PadelEngine`) and from Node (`require('./padel-engine.js')`) for tests.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
  } else {
    root.PadelEngine = mod;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SEQ = [0, 15, 30, 40];
  const DEFAULT_SERVE_ORDER = [
    { t: 'a', p: 0 }, { t: 'b', p: 1 }, { t: 'a', p: 1 }, { t: 'b', p: 0 }
  ];

  function other(t) { return t === 'a' ? 'b' : 'a'; }
  function clone(s) { return JSON.parse(JSON.stringify(s)); }

  function createInitialState(overrides) {
    const base = {
      names: { a: 'TEAM A', b: 'TEAM B' },
      players: { a: ['', ''], b: ['', ''] },
      servingActive: false,
      serverIndex: 0,
      initialServerIndex: 0,
      serveOrder: DEFAULT_SERVE_ORDER.map(s => ({ t: s.t, p: s.p })),
      voiceOn: true,
      pts: { a: 0, b: 0 },
      games: { a: 0, b: 0 },
      sets: { a: 0, b: 0 },
      tiebreak: false,
      matchOver: false,
      winner: null,
      setsToWin: 2,
      setHistory: [],
      gamesInSet: 0,       // games completed in the CURRENT set — drives change-of-ends
      tbStartServerIndex: 0,
      tbPointsPlayed: 0,
      startTime: Date.now(),
      setStartTime: Date.now(),
      matchStarted: false
    };
    return Object.assign(base, overrides || {});
  }

  function advanceServer(state) {
    if (!state.servingActive) return;
    state.serverIndex = (state.serverIndex + 1) % 4;
  }

  // Change of ends after the 1st, 3rd, 5th... game of the CURRENT set.
  // Returns true/false — does not mutate changeEndsPending itself (caller decides).
  function checkChangeEndsOnGame(state) {
    state.gamesInSet++;
    return (state.gamesInSet % 2) === 1;
  }

  function winSet(state, team, info) {
    info.setWon = team;
    const mins = Math.max(0, Math.round((Date.now() - state.setStartTime) / 60000));
    state.setHistory.push({ a: state.games.a, b: state.games.b, mins });
    state.setStartTime = Date.now();
    state.sets[team]++;
    state.games.a = 0; state.games.b = 0;
    state.gamesInSet = 0;
    state.tiebreak = false;
    if (state.sets[team] >= state.setsToWin) {
      state.matchOver = true;
      state.winner = team;
      info.matchWon = team;
    }
  }

  function winGame(state, team, info) {
    const changeEnds = checkChangeEndsOnGame(state);
    advanceServer(state);
    info.gameWon = team;
    if (changeEnds) info.changeEnds = true;
    state.games[team]++;
    state.pts.a = 0; state.pts.b = 0;
    state.tiebreak = false;

    const g = state.games, o = other(team);
    if (g[team] === 6 && g[o] === 6) {
      state.tiebreak = true;
      state.tbPointsPlayed = 0;
      state.tbStartServerIndex = state.serverIndex;
      info.tiebreakStarted = true;
    } else if (g[team] >= 6 && g[team] - g[o] >= 2) {
      winSet(state, team, info);
    } else if (g[team] === 7) {
      // Defensive fallback — shouldn't normally be reachable outside the
      // tiebreak-win path, but guards against ever getting stuck at 7-x.
      winSet(state, team, info);
    }
  }

  function winTiebreak(state, team, info) {
    const changeEnds = checkChangeEndsOnGame(state);
    if (changeEnds) info.changeEnds = true;
    state.games[team]++;
    state.pts.a = 0; state.pts.b = 0;
    state.tiebreak = false;
    if (state.servingActive) {
      state.serverIndex = (state.tbStartServerIndex + 1) % 4;
    }
    state.tbPointsPlayed = 0;
    info.gameWon = team;
    winSet(state, team, info);
  }

  /**
   * Apply a single point for `team` to `state` (a plain, already-cloned state
   * object — this function mutates it in place for efficiency and returns it).
   * Returns { state, info } where `info` describes what happened on this point,
   * for the caller (voice/UI layer) to decide what to announce. `info` is not
   * needed when replaying history — only for the live point.
   */
  function stepPoint(state, team) {
    const info = {
      gameWon: null,       // team that won a game this point, if any
      setWon: null,         // team that won a set this point, if any
      matchWon: null,       // team that won the match this point, if any
      tiebreakStarted: false,
      changeEnds: false,    // ends should change after this point
      serverChangedMidTiebreak: false
    };
    if (state.matchOver) return { state, info };

    const o = other(team);

    if (state.tiebreak) {
      const prevServerIndex = state.serverIndex;
      state.pts[team]++;
      state.tbPointsPlayed++;
      if (state.servingActive) {
        const turn = Math.ceil(state.tbPointsPlayed / 2);
        state.serverIndex = (state.tbStartServerIndex + turn) % 4;
      }
      const wouldWin = state.pts[team] >= 7 && (state.pts[team] - state.pts[o]) >= 2;
      if (wouldWin) {
        winTiebreak(state, team, info);
      } else {
        const total = state.pts.a + state.pts.b;
        if (total > 0 && total % 6 === 0) info.changeEnds = true;
      }
      if (state.servingActive && prevServerIndex !== state.serverIndex && !info.gameWon) {
        info.serverChangedMidTiebreak = true;
      }
      return { state, info };
    }

    const p = state.pts[team], op = state.pts[o];
    if (p === 40) {
      if (op === 40) {
        state.pts[team] = 'AD';
      } else if (op === 'AD') {
        state.pts[o] = 40; // back to deuce
      } else {
        winGame(state, team, info);
      }
    } else if (p === 'AD') {
      winGame(state, team, info);
    } else {
      const idx = SEQ.indexOf(p);
      state.pts[team] = SEQ[idx + 1];
    }
    return { state, info };
  }

  /** Pure point application against an existing state — returns a NEW state, doesn't mutate the input. */
  function applyPointWithInfo(state, team) {
    const s = clone(state);
    return stepPoint(s, team);
  }

  /** For replay: apply a point and just take the resulting state (used to fold over event history). */
  function reducePoint(state, team) {
    return applyPointWithInfo(state, team).state;
  }

  /** Replay an ordered list of {team} point events on top of a checkpoint state. */
  function replay(checkpointState, points) {
    let s = clone(checkpointState);
    for (const pt of points) {
      s = stepPoint(s, pt.team).state;
    }
    return s;
  }

  function scoreWord(p) { return p === 0 ? 'love' : String(p); }

  function pointSignificance(state, team) {
    const o = other(team);
    if (state.tiebreak) {
      const wouldWinTB = (state.pts[team] + 1 >= 7) && ((state.pts[team] + 1) - state.pts[o] >= 2);
      if (!wouldWinTB) return null;
      return (state.sets[team] + 1 >= state.setsToWin) ? 'Match point' : 'Set point';
    }
    const atAdvantage = state.pts[team] === 'AD';
    const atGamePoint = state.pts[team] === 40 && state.pts[o] !== 40 && state.pts[o] !== 'AD';
    if (!atAdvantage && !atGamePoint) return null;
    const newGames = state.games[team] + 1, oppGames = state.games[o];
    const wouldWinSet = (newGames >= 6 && newGames - oppGames >= 2) || newGames === 7;
    if (!wouldWinSet) return null;
    return (state.sets[team] + 1 >= state.setsToWin) ? 'Match point' : 'Set point';
  }

  return {
    SEQ,
    DEFAULT_SERVE_ORDER,
    other,
    clone,
    createInitialState,
    applyPointWithInfo,
    reducePoint,
    replay,
    scoreWord,
    pointSignificance
  };
});
