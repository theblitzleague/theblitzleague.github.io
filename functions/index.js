/* Blitz Hub phone notifications.

   announce: when the commissioner posts to announcements/{id} (only the commissioner can, see firestore.rules), send it
   to every registered phone of a GM who is linked to a team, plus the commissioner's own. The message is data-only:
   sw.js on the phone turns it into the notification, so it looks the same everywhere. Phones whose registration has
   expired are removed. The send result (sent / failed) is written back onto the announcement for the Commissioner panel. */
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
const GONE = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'];

// duesReminders: each morning at 10:00 Central during the founding dues window, a private Hub message to every linked GM
// whose team has no dues entry in the ledger for that season (rule 6-1-2: due March 13, seat lost if unpaid March 18).
// A dues entry counts unless a "void" entry cancels it, the same way the ledger page counts it.
const DUES = { season: 2027, dates: {
  '2027-03-06': ['Dues due in one week', 'Your $100 Blitz League dues are due March 13. Pay on Venmo @gwilso22, Friends & Family, note "Blitz League dues 2027". The QR code is on Awards > Prizes & Ledger.'],
  '2027-03-12': ['Dues due tomorrow', 'Your $100 Blitz League dues are due tomorrow, March 13. Venmo @gwilso22, Friends & Family, note "Blitz League dues 2027".'],
  '2027-03-14': ['Dues are past due', 'Your Blitz League dues were due March 13. Under rule 6-1-2, a team still unpaid on March 18 goes to a replacement owner before the draft. Venmo @gwilso22.'],
  '2027-03-17': ['Last day for dues', 'Tomorrow, March 18, an unpaid team goes to a replacement owner (rule 6-1-2). Pay today: Venmo @gwilso22, note "Blitz League dues 2027".'],
} };
// Each year the same dates apply to the dues season the commissioner opened with the season tools (config/season), so
// the reminders move forward on their own: [month-day, title, body] with {Y} standing for the season.
const duesFor = Y => Object.fromEntries(Object.entries(DUES.dates).map(([d, [t, b]]) => [`${Y}${d.slice(4)}`, [t, b.replace(/2027/g, String(Y))]]));
exports.duesReminders = onSchedule({ schedule: '0 10 * * *', timeZone: 'America/Chicago', region: 'us-central1', retryCount: 0 }, async () => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const db = getFirestore();
  const Y = Number(((await db.doc('config/season').get()).data() || {}).duesSeason) || DUES.season;
  const msg = duesFor(Y)[today];
  if (!msg) return;
  const entries = (await db.collection('ledger').where('season', '==', Y).get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const voided = new Set(entries.filter(e => e.kind === 'void').map(e => e.ref));
  const paid = new Set(entries.filter(e => e.kind === 'dues' && !voided.has(e.id)).map(e => e.team));
  const users = (await db.collection('users').get()).docs.filter(d => d.data().team && !paid.has(d.data().team));
  await Promise.all(users.map(u => db.collection('notes').add({ to: u.id, team: u.data().team, by: 'system', at: FieldValue.serverTimestamp(), title: msg[0], body: msg[1] })));
});

// note: a private message to one GM (notes/{id}); goes only to that GM's registered devices.
exports.note = onDocumentCreated({ document: 'notes/{id}', region: 'us-central1', maxInstances: 2 }, async event => {
  const snap = event.data;
  if (!snap) return;
  const n = snap.data(), db = getFirestore();
  const devices = (await db.collection('devices').where('uid', '==', n.to).get()).docs.filter(d => d.data().token);
  if (!devices.length) { await snap.ref.update({ sent: 0, failed: 0, done: true }); return; }
  const res = await getMessaging().sendEachForMulticast({
    tokens: devices.map(d => d.data().token),
    data: { kind: 'note', title: String(n.title || 'Commissioner'), body: String(n.body || ''), url: './account.html', tag: 'note-' + event.params.id },
    webpush: { headers: { Urgency: 'high', TTL: String(3 * 24 * 3600) } },
  });
  await Promise.all(res.responses.map((r, j) => (!r.success && r.error && GONE.includes(r.error.code) ? devices[j].ref.delete() : null)));
  await snap.ref.update({ sent: res.successCount, failed: res.failureCount, done: true });
});

exports.announce = onDocumentCreated({ document: 'announcements/{id}', region: 'us-central1', maxInstances: 2 }, async event => {
  const snap = event.data;
  if (!snap) return;
  const a = snap.data(), db = getFirestore();
  const commish = ((await db.doc('config/roles').get()).data() || {}).commish || [];
  const users = await db.collection('users').get();
  const allowed = new Set([...commish, ...users.docs.filter(d => d.data().team).map(d => d.id)]);
  const devices = (await db.collection('devices').get()).docs.filter(d => allowed.has(d.data().uid) && d.data().token);
  if (!devices.length) { await snap.ref.update({ sent: 0, failed: 0, done: true }); return; }

  let sent = 0, failed = 0;
  for (let i = 0; i < devices.length; i += 500) {                 // the send limit per call
    const batch = devices.slice(i, i + 500);
    const res = await getMessaging().sendEachForMulticast({
      tokens: batch.map(d => d.data().token),
      data: { kind: 'announcement', title: String(a.title || 'Commissioner'), body: String(a.body || ''), url: './#announcements', tag: 'announce-' + event.params.id },
      webpush: { headers: { Urgency: 'high', TTL: String(3 * 24 * 3600) } },
    });
    sent += res.successCount; failed += res.failureCount;
    await Promise.all(res.responses.map((r, j) => (!r.success && r.error && GONE.includes(r.error.code) ? batch[j].ref.delete() : null)));
  }
  await snap.ref.update({ sent, failed, done: true });
});

// tradeAlert: a new offer (or counter) goes straight to the phones of the receiving team's linked GMs, and opens their
// Trades tab when tapped. Only that team's GMs are notified; nobody else learns of the offer.
exports.tradeAlert = onDocumentCreated({ document: 'trades/{id}', region: 'us-central1', maxInstances: 2 }, async event => {
  const snap = event.data;
  if (!snap) return;
  const T = snap.data(), db = getFirestore();
  if (T.status !== 'offered') return;
  const fr = ((await getJSON(`${SITE}/data/franchises.json?t=${Date.now()}`).catch(() => null)) || {}).franchises || {};
  const name = id => (fr[String(id)] ? `${fr[String(id)].location}${fr[String(id)].nickname ? ' ' + fr[String(id)].nickname : ''}` : `Team ${id}`);
  const gms = (await db.collection('users').where('team', 'in', [T.to, String(T.to)]).get()).docs.map(d => d.id);
  const devices = gms.length ? (await db.collection('devices').where('uid', 'in', gms.slice(0, 30)).get()).docs.filter(d => d.data().token) : [];
  if (!devices.length) { await snap.ref.update({ alerted: 0 }); return; }
  const res = await getMessaging().sendEachForMulticast({
    tokens: devices.map(d => d.data().token),
    data: { kind: 'trade', title: '🚨TRADE ALERT🚨', body: `${name(T.from)} ${T.counterOf ? 'countered your offer' : 'sent you a trade offer'}. Tap to review it.`,
      url: `./team.html?team=${T.to}#trades`, tag: 'trade-' + event.params.id },
    webpush: { headers: { Urgency: 'high', TTL: String(3 * 24 * 3600) } },
  });
  await Promise.all(res.responses.map((r, j) => (!r.success && r.error && GONE.includes(r.error.code) ? devices[j].ref.delete() : null)));
  await snap.ref.update({ alerted: res.successCount });
});

// watchRefresh: every morning at 5:30 Central, check that the 2:37 AM GitHub job (.github/workflows/refresh-data.yml)
// actually refreshed the site. It looks at the result, data/nfl.json's "built" time on the live site, so it catches any
// failure along the way (the job, the push, the site rebuild). If it's stale, the owner gets a private message.
exports.watchRefresh = onSchedule({ schedule: '30 5 * * *', timeZone: 'America/Chicago', region: 'us-central1', retryCount: 0 }, async () => {
  let built = null, why = '';
  try {
    const r = await fetch('https://theblitzleague.github.io/data/nfl.json?check=' + Date.now(), { cache: 'no-store' });
    if (r.ok) built = (await r.json()).built || null; else why = `the site answered ${r.status}`;
  } catch (e) { why = "the site couldn't be reached"; }
  const hours = built ? (Date.now() - Date.parse(built)) / 36e5 : null;
  if (hours != null && hours < 20) return;                         // refreshed overnight: all good
  const db = getFirestore(), roles = (await db.doc('config/roles').get()).data() || {};
  const to = roles.owner || (roles.commish || [])[0];
  if (!to) return;
  const last = built ? new Date(built).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }) + ' Central' : null;
  await db.collection('notes').add({ to, team: null, by: 'system', at: FieldValue.serverTimestamp(), title: "Nightly refresh didn't update the site",
    body: (last ? `The site's NFL data was last updated ${last}. ` : `Couldn't check the site's NFL data (${why}). `)
      + 'Check the "Refresh data" run at github.com/theblitzleague/theblitzleague.github.io/actions, or ask ALFRED to look into it.' });
});

// liveScores: every 2 minutes, while an NFL game is on, score every player live with the League's scoring and save it for
// the Hub (live/current, plus live/{season}-w{week} kept per week). Anyone may read it (firestore.rules); only this job writes.
//   Stats: Sleeper's public live stats feed (same stat names as the scoring settings, so FG distances, pick-sixes and
//   yardage bonuses score exactly). Game clocks and scores: ESPN's scoreboard. Scoring: the Hub's own settings
//   (data/scoring.json).
// It does nothing between games: it runs when a game is in progress, or once more when one has just gone final.
const ESPN_NFL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const TEAMFIX = { WSH: 'WAS' };
// The League's scoring: the Hub's own settings file (data/scoring.json on the site), not Sleeper's league settings.
// Scoring changes (made by the commissioner on the Account page) are stored as versions in config/scoring, each with the
// season and week it starts. Every week is scored with the version in effect that week, so a change never touches a
// game already played. data/scoring.json is the original version, in effect from the start.
const wk = (season, week) => Number(season) * 100 + Number(week);
async function scoringVersions() {
  const [base, doc] = await Promise.all([getJSON(`${SITE}/data/scoring.json?t=${Date.now()}`), getFirestore().doc('config/scoring').get()]);
  return { base: base.settings || {}, versions: ((doc.data() || {}).versions || []).slice().sort((a, b) => wk(a.season, a.week) - wk(b.season, b.week)) };
}
function scoringAt(S, season, week) {
  let out = S.base;
  for (const v of S.versions) if (wk(v.season, v.week) <= wk(season, week)) out = v.settings;
  return out;
}
const leagueScoring = async (season, week) => scoringAt(await scoringVersions(), season, week);
const getJSON = async u => { const r = await fetch(u, { headers: { 'User-Agent': 'blitz-hub' } }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
const num = (s, k) => (typeof s[k] === 'number' ? s[k] : 0);
const trim = v => (Number.isInteger(v) ? String(v) : v.toFixed(1));
function statLine(s) {
  const out = [];
  if (num(s, 'pass_att')) out.push(`${trim(num(s, 'pass_cmp'))}/${trim(num(s, 'pass_att'))}, ${trim(num(s, 'pass_yd'))} pass yd` + (num(s, 'pass_td') ? `, ${trim(num(s, 'pass_td'))} TD` : '') + (num(s, 'pass_int') ? `, ${trim(num(s, 'pass_int'))} INT` : ''));
  if (num(s, 'rush_att')) out.push(`${trim(num(s, 'rush_att'))} car, ${trim(num(s, 'rush_yd'))} yd` + (num(s, 'rush_td') ? `, ${trim(num(s, 'rush_td'))} TD` : ''));
  if (num(s, 'rec') || num(s, 'rec_tgt')) out.push(`${trim(num(s, 'rec'))}/${trim(num(s, 'rec_tgt'))} rec, ${trim(num(s, 'rec_yd'))} yd` + (num(s, 'rec_td') ? `, ${trim(num(s, 'rec_td'))} TD` : ''));
  if (num(s, 'fga') || num(s, 'xpa')) out.push(`FG ${trim(num(s, 'fgm'))}/${trim(num(s, 'fga'))}, XP ${trim(num(s, 'xpm'))}/${trim(num(s, 'xpa'))}`);
  const d = [['idp_tkl', 'tkl'], ['idp_tkl_loss', 'TFL'], ['idp_sack', 'sack'], ['idp_qb_hit', 'QB hit'], ['idp_int', 'INT'], ['idp_pass_def', 'PD'], ['idp_ff', 'FF']]
    .filter(([k]) => num(s, k)).map(([k, l]) => `${trim(num(s, k))} ${l}`);
  if (d.length) out.push(d.join(', '));
  if (num(s, 'fum_lost')) out.push(`${trim(num(s, 'fum_lost'))} fum lost`);
  return out.join(' · ');
}
exports.liveScores = onSchedule({ schedule: 'every 2 minutes', region: 'us-central1', retryCount: 0, timeoutSeconds: 90, memory: '512MiB', maxInstances: 1 }, async () => {
  const sb = await getJSON(`${ESPN_NFL}/scoreboard`);
  if (Number((sb.season || {}).type) !== 2) return;                // preseason, NFL playoffs and offseason games never count
  const games = (sb.events || []).map(e => {
    const c = e.competitions[0], side = h => { const t = c.competitors.find(x => x.homeAway === h); const a = t.team.abbreviation; return { abbr: TEAMFIX[a] || a, score: Number(t.score || 0) }; };
    return { id: e.id, at: e.date, state: e.status.type.state, detail: e.status.type.shortDetail, away: side('away'), home: side('home') };
  });
  const db = getFirestore(), ref = db.doc('live/current');
  const prev = (await ref.get()).data() || {};
  const was = Object.fromEntries((prev.states || []).map(x => x.split(':')));
  const changed = games.some(g => was[g.id] !== g.state);
  if (!games.some(g => g.state === 'in') && !changed) return;      // no game on, nothing new since the last run

  // The week's season and number from the same ESPN scoreboard the lineup locks use, so both save to the same week.
  const season = String((sb.season || {}).year), week = Number((sb.week || {}).number);
  const scoring = await leagueScoring(season, week);
  const rows = await getJSON(`https://api.sleeper.com/stats/nfl/${season}/${week}?season_type=regular&t=${Date.now()}`);
  const players = {};
  let newest = 0;
  for (const r of rows) {
    const s = r.stats || {};
    if (!/^\d+$/.test(String(r.player_id)) || !Object.keys(s).length) continue;     // team rows (no team D slot) and empty rows
    newest = Math.max(newest, r.updated_at || 0);
    const pts = Object.entries(scoring).reduce((t, [k, v]) => t + (typeof s[k] === 'number' ? v * s[k] : 0), 0);
    players[r.player_id] = [Math.round(pts * 100) / 100, r.team || null, statLine(s)];
  }
  const data = { season, week, updated: new Date().toISOString(), statsAt: newest ? new Date(newest).toISOString() : null, games, players };
  const doc = { season, week, updated: FieldValue.serverTimestamp(), states: games.map(g => `${g.id}:${g.state}`), json: JSON.stringify(data) };
  await Promise.all([ref.set(doc), db.doc(`live/${season}-w${week}`).set(doc)]);
  // Keep this week's Hub lineups as they stand during the games. Every team gets an entry (an empty one if it never set a
  // lineup), and a starter whose game has kicked off is frozen in that week's record: nothing after kickoff (a move, a
  // release by his NFL team) can take him or his points out of that week.
  const [lu, sn, ro, P] = await Promise.all([db.doc('league/lineups').get(), db.doc(`lineups/${season}-w${week}`).get(), db.doc('league/rosters').get(), playerInfo()]);
  const standing = ((lu.data() || {}).teams) || {}, before = ((sn.data() || {}).teams) || {}, rosters = ((ro.data() || {}).rosters) || {};
  const kicked = new Set(games.filter(g => g.state !== 'pre').flatMap(g => [g.away.abbr, g.home.abbr]));
  const played = id => !!(players[id] || (P[id] && P[id].team && kicked.has(P[id].team)));
  const teams = {};
  for (const t of new Set([...Object.keys(rosters), ...Object.keys(standing)])) teams[t] = freeze(before[t], standing[t], played);
  if (Object.keys(teams).length) await db.doc(`lineups/${season}-w${week}`).set({ teams, season, week, updated: Date.now() }, { merge: true });
});
// A week's lineup record: the new lineup, except that any spot whose player has already kicked off keeps him.
function freeze(prev, next, played) {
  const out = SLOTS.map((_, i) => ((next || [])[i] ? String(next[i]) : null));
  (prev || []).forEach((id, i) => { if (id && i < out.length && played(id)) { const j = out.indexOf(id); if (j >= 0 && j !== i) out[j] = null; out[i] = id; } });
  return out;
}
// The weekly moves batch: Wednesday 3 AM Central, when the week's scores are in (official Tuesday 5 AM, rule 2-2-3), ESPN
// has moved to the new week and no game is near. Trades and waiver claims go through only then. The first such time at
// or after `after`.
function nextBatch(after) {
  for (let i = 0; i < 9; i++) { const p = chiParts(after + i * 864e5); if (p.weekday === 'Wed') { const at = chiTime(+p.year, +p.month, +p.day, 3); if (at >= after) return at; } }
  return after + 7 * 864e5;
}
const BATCH_SLACK = 20 * 60e3;   // the batch counts anything due within a few minutes of its start

/* ---------- Draft room (draftroom.html) ----------
   Every draft change goes through the one callable function below, which checks it inside a database transaction, so
   two people can never take the same player or pick out of turn. Pages only read (firestore.rules).
     drafts/{id}             settings, seats, every pick so far, whose clock is running (clockEnd, ms since 1970)
     drafts/{id}/pool/all    the eligible players, best first: "id|POS|Name|NFL team|points per game"
     drafts/{id}/queues/{t}  team t's queue (its GM and the commissioners can read it)
   Rulebook 8-2: linear order (the same team order every round); a missed pick is made from the team's queue, else the
   best available player; no team may hold more than 2 QBs (8-1-4). In a practice draft, a seat with nobody in it is a
   simulated drafter: it picks automatically after simDelay seconds. Clocks are enforced by whoever is watching (each
   page calls "tick" when the clock hits zero) and by draftClock, a once-a-minute backstop. */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const SITE = 'https://theblitzleague.github.io';
const DRAFT_POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DL', 'LB', 'DB'], IDP_POS = ['DL', 'LB', 'DB'];
const IDPMAP = { DE: 'DL', DT: 'DL', NT: 'DL', ILB: 'LB', OLB: 'LB', MLB: 'LB', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB' };
const NEED = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DL: 1, LB: 1, DB: 1 };   // one of each starting spot (rulebook 7-2-1)
const CAP = { QB: 2, K: 2, TE: 4 };                                        // QB is the rule (8-1-4); K and TE only steer automatic picks

async function buildPool(kind) {
  const t = Date.now();
  const [players, nfl] = await Promise.all([getJSON(`${SITE}/data/players.json?t=${t}`), getJSON(`${SITE}/data/nfl.json?t=${t}`)]);
  const stats = nfl.players || {}, out = [];
  for (const [id, p] of Object.entries(players)) {
    if (!p.team || !p.full_name || p.full_name.startsWith('Duplicate Player')) continue;   // Sleeper placeholders
    if (kind === 'rookie' && p.years_exp !== 0) continue;
    const g = (p.fantasy_positions || []).find(x => IDP_POS.includes(x)) || IDPMAP[p.position];
    const pos = DRAFT_POS.includes(p.position) ? p.position : g || null;
    if (!pos) continue;
    const s = stats[id], gp = s ? s[0] : 0, ppg = gp ? s[1] / gp : 0;
    out.push([gp >= 3 ? ppg : ppg * gp / 3, `${id}|${pos}|${p.full_name.replace(/\|/g, '')}|${p.team}|${ppg.toFixed(1)}`]);
  }
  return out.sort((a, b) => b[0] - a[0]).slice(0, kind === 'rookie' ? 300 : 1000).map(x => x[1]);
}
const parsePool = list => list.map((s, rank) => { const [id, pos, name, team, ppg] = s.split('|'); return { id, pos, name, team, ppg: +ppg, rank }; });
// Whose pick it is. A rookie draft follows pick ownership: d.owners (set when it starts) lists the team holding each pick
// in order, after trades (league/picks); otherwise the order in d.teams repeats every round.
const onClock = d => (Array.isArray(d.owners) && d.owners.length ? d.owners[d.picks.length] : d.teams[d.picks.length % d.teams.length]);
async function pickOwners(db, d) {
  const traded = ((await db.doc('league/picks').get()).data() || {}).traded || [], season = String(d.pickSeason);
  const out = [];
  for (let r = 1; r <= d.rounds; r++) for (const t of d.teams) {
    const x = traded.find(p => String(p.season) === season && Number(p.round) === r && Number(p.roster_id) === Number(t));
    out.push(x ? Number(x.owner_id) : Number(t));
  }
  return out;
}

// Whose turn it is next, and when their clock runs out.
function advance(d, now) {
  if (d.picks.length >= d.rounds * d.teams.length) { d.status = 'done'; d.clockEnd = null; return; }
  const t = String(onClock(d));
  d.clockEnd = now + 1000 * (d.practice && !d.seats[t] ? d.simDelay : d.clockSec);
}

function legalFor(d, posOf, team) {
  const taken = new Set(d.picks.map(x => x.p));
  const mine = d.picks.filter(x => x.t === team).map(x => posOf[x.p]);
  const count = pos => mine.filter(x => x === pos).length;
  return { mine, count, ok: id => !!posOf[id] && !taken.has(id) && !(posOf[id] === 'QB' && count('QB') >= 2) };
}

// The automatic pick: the team's queue first, then the best available player, filling empty starting spots when the
// remaining picks only just cover them. Simulated drafters pick from the top three, so practice drafts vary.
function autoChoice(d, pool, posOf, team, queue) {
  const { mine, count, ok } = legalFor(d, posOf, team);
  for (const q of queue || []) if (ok(q)) return q;
  let avail = pool.filter(e => ok(e.id));
  if (d.kind !== 'rookie') {
    avail = avail.filter(e => CAP[e.pos] == null || count(e.pos) < CAP[e.pos]);
    const open = Object.entries(NEED).filter(([p, k]) => count(p) < k);
    const openCount = open.reduce((a, [p, k]) => a + k - count(p), 0), left = d.rounds - mine.length;
    const round = Math.floor(d.picks.length / d.teams.length) + 1;
    if (left <= openCount + 1 && open.length) avail = avail.filter(e => open.some(([p]) => p === e.pos)).concat(avail);
    else if (round < d.rounds - 6) avail = avail.filter(e => e.pos !== 'K').concat(avail.filter(e => e.pos === 'K'));
  }
  if (!avail.length) return null;
  if (!d.practice) return avail[0].id;
  const r = Math.random(), i = r < 0.6 ? 0 : r < 0.85 ? 1 : 2;
  return (avail[Math.min(i, avail.length - 1)]).id;
}

// After any pick: if the team now on the clock has a queue (with auto-draft on) whose first player still available is
// legal for them, that player is drafted at once, and so on down the order. `override` is a queue being saved right now.
async function chainQueue(tx, db, id, d, pool, posOf, now, override) {
  for (let i = 0; i < 64 && d.status === 'live'; i++) {
    const team = onClock(d), t = String(team);
    if (!d.seats[t] && !(override && override.team === t)) return;               // computer seats have no queue
    const q = override && override.team === t ? override : (await tx.get(db.doc(`drafts/${id}/queues/${t}`))).data() || {};
    if (q.auto === false) return;
    const { ok } = legalFor(d, posOf, team), p = (q.list || []).find(ok);
    if (!p) return;
    d.picks.push({ p, t: team, by: 'queue', at: now });
    advance(d, now);
  }
}

// Make a finished draft the league's rosters (league/rosters), replacing any earlier official draft. Does its reads now
// and returns the writes, so it can run inside the draft transaction before anything is written.
async function officialWrites(tx, db, id, d, now, uid) {
  const L = (await tx.get(db.doc('league/rosters'))).data();
  // A rookie draft adds its picks to the existing rosters (a dynasty keeps everyone); only a startup draft builds them.
  if (d.kind === 'rookie') {
    if (!L || !L.rosters) throw new HttpsError('failed-precondition', 'There are no league rosters to add rookies to yet. Make the startup draft official first.');
    if ((L.rookieDrafts || []).includes(id)) return [];
    const rosters = JSON.parse(JSON.stringify(L.rosters));
    for (const p of d.picks) { const k = String(p.t); rosters[k] = [...new Set([...(rosters[k] || []), p.p])]; }
    d.official = true; d.officialAt = now;
    return [[db.doc('league/rosters'), { rosters, rookieDrafts: [...(L.rookieDrafts || []), id], rookieSeasons: [...new Set([...(L.rookieSeasons || []), Number(d.pickSeason)].filter(Boolean))], updated: now }, 'update']];
  }
  // A dynasty has one startup draft. Once the real league has started (the founding reset), its rosters are never replaced.
  const C = (await tx.get(db.doc('config/season'))).data() || {};
  if (C.founding && L && L.rosters && L.source !== id) throw new HttpsError('failed-precondition', `The league's rosters came from ${L.name || 'the startup draft'}. A dynasty has one startup draft; later drafts are rookie drafts, which add to the rosters.`);
  // Every team starts with a full lineup: each spot filled with the best player drafted for it (draft board order), so
  // nobody scores zero in Week 1 for not having set one. GMs change it from there.
  const poolDoc = (await tx.get(db.doc(`drafts/${id}/pool/all`))).data();
  const rank = {}, posOf = {}; for (const e of parsePool((poolDoc || {}).list || [])) { rank[e.id] = e.rank; posOf[e.id] = e.pos; }
  const order = SLOTS.map((_, i) => i).sort((a, b) => ELIG[SLOTS[a]].length - ELIG[SLOTS[b]].length);
  const lineups = {};
  for (const t of d.teams) {
    const mine = d.picks.filter(p => String(p.t) === String(t)).map(p => p.p).sort((a, b) => (rank[a] ?? 1e9) - (rank[b] ?? 1e9)), used = new Set(), slots = SLOTS.map(() => null);
    for (const i of order) { const best = mine.find(x => !used.has(x) && ELIG[SLOTS[i]].includes(posOf[x])); if (best) { slots[i] = best; used.add(best); } }
    lineups[String(t)] = slots;
  }
  const prevRef = L && L.source && L.source !== id ? db.doc(`drafts/${L.source}`) : null;
  const prev = prevRef ? await tx.get(prevRef) : null;
  const rosters = {}; for (const t of d.teams) rosters[String(t)] = [];
  for (const p of d.picks) rosters[String(p.t)].push(p.p);
  d.official = true; d.officialAt = now;
  // Hub scoring starts with the first week the new rosters can set a lineup. A draft held in the offseason (the real
  // startup draft is in March) starts at Week 1; one made official mid-season starts the next unplayed week.
  let startWeek = null, startSeason = null;
  try {
    const st = await getJSON('https://api.sleeper.app/v1/state/nfl'); startSeason = Number(st.season);
    if (st.season_type !== 'regular') startWeek = 1;
    else { const G = await weekGames(); startWeek = G.week + (Object.values(G.byTeam).some(g => g.started) ? 1 : 0); }
  } catch (e) { /* weekResults sets it */ }
  const out = [[db.doc('league/rosters'), { source: id, name: d.name, kind: d.kind, practice: !!d.practice, rosters, picks: d.picks.length, at: now, by: uid || 'auto', startWeek, startSeason }],
    [db.doc('league/lineups'), { teams: lineups, updated: now, auto: true }]];
  if (prev && prev.exists) out.push([prevRef, { official: false, updated: now }, 'update']);
  return out;
}

async function draftAct(db, uid, commish, data, myTeam) {
  let unpaidNow = new Set(), duesSeason = null;
  if (['pick', 'queue'].includes(data.action) && !commish && uid) {
    const cal = await leagueCalendar(db, await getJSON('https://api.sleeper.app/v1/state/nfl'));
    unpaidNow = await unpaidTeams(db, cal); duesSeason = cal.season;
  }
  const now = Date.now(), action = data.action, only = () => { if (!commish) throw new HttpsError('permission-denied', 'Only the commissioner can do that.'); };
  if (action === 'create') {
    only();
    const kind = data.kind === 'rookie' ? 'rookie' : 'startup';
    const teams = (data.teams || []).map(Number);
    if (teams.length < 2 || teams.length > 32 || new Set(teams).size !== teams.length || teams.some(t => !Number.isInteger(t) || t < 1 || t > 32)) throw new HttpsError('invalid-argument', 'Bad draft order.');
    const rounds = Math.min(30, Math.max(1, parseInt(data.rounds, 10) || (kind === 'rookie' ? 4 : 24)));
    const clockSec = Math.min(86400, Math.max(10, parseInt(data.clockSec, 10) || 120));
    const simDelay = Math.min(60, Math.max(1, parseInt(data.simDelay, 10) || 2));
    if (kind === 'startup' && data.official) {
      const [L, C] = await Promise.all([db.doc('league/rosters').get(), db.doc('config/season').get()]);
      if ((C.data() || {}).founding && L.exists && (L.data() || {}).rosters) throw new HttpsError('failed-precondition', 'The league already had its startup draft. Make a rookie draft, or a mock draft for practice.');
    }
    let pool = await buildPool(kind);
    if (kind === 'rookie') {                                  // a rookie already on a Blitz roster can't be drafted again
      const onRoster = new Set(Object.values(((await db.doc('league/rosters').get()).data() || {}).rosters || {}).flat());
      pool = pool.filter(s => !onRoster.has(s.split('|')[0]));
    }
    const pickSeason = kind === 'rookie' ? (parseInt(data.pickSeason, 10) || Number((await getJSON('https://api.sleeper.app/v1/state/nfl')).season)) : null;
    const ref = db.collection('drafts').doc();
    await db.doc(`drafts/${ref.id}/pool/all`).set({ list: pool });
    await ref.set({ name: String(data.name || '').slice(0, 60) || `${kind === 'rookie' ? 'Rookie' : 'Startup'} ${data.official ? 'draft' : 'mock draft'}`, kind, rounds, clockSec, simDelay,
      // Mock drafts never touch the rosters. An official draft's picks become the league rosters the moment it ends.
      practice: !data.official, mode: data.official ? 'official' : 'mock', teams, pickSeason, seats: {}, picks: [], status: 'setup', clockEnd: null, pausedLeft: null, official: false,
      by: uid, created: now, updated: now });
    return { id: ref.id };
  }
  const id = String(data.id || ''); if (!/^[A-Za-z0-9]{10,40}$/.test(id)) throw new HttpsError('invalid-argument', 'No such draft.');
  const ref = db.doc(`drafts/${id}`);
  if (action === 'delete') {
    only();
    const L = (await db.doc('league/rosters').get()).data();
    if (L && L.source === id) throw new HttpsError('failed-precondition', 'This draft made the league rosters. Unmark it as official before deleting it.');
    await db.recursiveDelete(ref); return { ok: true };
  }
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref); if (!snap.exists) throw new HttpsError('not-found', 'No such draft.');
    const d = snap.data();
    const mine = t => d.seats[String(t)] === uid;
    if (d.mode === 'official' && myTeam != null && unpaidNow.has(String(myTeam))) throw new HttpsError('failed-precondition', unpaidMsg(duesSeason));
    const needPool = ['pick', 'tick', 'start', 'resume', 'queue', 'join', 'seat'].includes(action);
    const pool = needPool ? parsePool((await tx.get(db.doc(`drafts/${id}/pool/all`))).data().list) : null;
    const posOf = pool ? Object.fromEntries(pool.map(e => [e.id, e.pos])) : null;
    const team = d.teams.length ? onClock(d) : null;
    const queue = action === 'tick' ? ((await tx.get(db.doc(`drafts/${id}/queues/${team}`))).data() || {}).list : null;
    let chain = ['pick', 'tick', 'start', 'resume', 'join', 'seat'].includes(action), override = null, extra = [];
    switch (action) {
      case 'setup': {
        only(); if (d.status !== 'setup') throw new HttpsError('failed-precondition', 'The draft has started.');
        if (Array.isArray(data.teams)) { const t = data.teams.map(Number); if (t.length !== d.teams.length || [...t].sort((a, b) => a - b).join() !== [...d.teams].sort((a, b) => a - b).join()) throw new HttpsError('invalid-argument', 'Bad draft order.'); d.teams = t; }
        if (data.clockSec) d.clockSec = Math.min(86400, Math.max(10, parseInt(data.clockSec, 10)));
        if (data.simDelay) d.simDelay = Math.min(60, Math.max(1, parseInt(data.simDelay, 10)));
        break;
      }
      // A GM opening the room sits at the team the commissioner linked to their account (Account page). Nobody picks a seat.
      case 'join': {
        const t = myTeam != null ? String(myTeam) : null;
        if (!t || !d.teams.map(String).includes(t)) return { ok: false, seat: null };
        if (d.seats[t] === uid) return { ok: true, seat: t };
        // One person per franchise: the linked GM always gets their own seat back (e.g. from the commissioner testing it).
        for (const k of Object.keys(d.seats)) if (d.seats[k] === uid) delete d.seats[k];
        d.seats[t] = uid;
        if (d.status === 'live' && String(team) === t) advance(d, now);
        break;
      }
      // The commissioner can put anyone in any seat, or empty it (the computer then drafts for that team).
      case 'seat': {
        only();
        const t = String(parseInt(data.team, 10)); if (!d.teams.map(String).includes(t)) throw new HttpsError('invalid-argument', 'No such team.');
        const who = data.uid === undefined ? uid : data.uid;
        if (who) for (const k of Object.keys(d.seats)) if (d.seats[k] === who) delete d.seats[k];   // one seat per person
        if (who) d.seats[t] = who; else delete d.seats[t];
        if (d.status === 'live' && String(team) === t) advance(d, now);                          // restart the clock for the new occupant
        break;
      }
      case 'queue': {
        const t = String(parseInt(data.team, 10)), list = [...new Set((data.list || []).map(String).filter(x => /^\d+$/.test(x)))].slice(0, 150);
        if (!d.teams.map(String).includes(t)) throw new HttpsError('invalid-argument', 'No such team.');
        if (!mine(t) && !commish) throw new HttpsError('permission-denied', "That isn't your team.");
        const prev = (await tx.get(db.doc(`drafts/${id}/queues/${t}`))).data() || {};
        override = { team: t, list, auto: data.auto === undefined ? prev.auto !== false : !!data.auto };
        extra.push([db.doc(`drafts/${id}/queues/${t}`), { list, auto: override.auto, updated: now }]);
        chain = d.status === 'live' && String(team) === t;
        break;
      }
      case 'start': only(); if (d.status !== 'setup') throw new HttpsError('failed-precondition', 'Already started.');
        if (d.kind === 'rookie' && d.pickSeason) d.owners = await pickOwners(db, d);       // traded picks go to their new owners
        d.status = 'live'; advance(d, now); break;
      case 'pause': only(); if (d.status !== 'live') throw new HttpsError('failed-precondition', 'Not running.'); d.status = 'paused'; d.pausedLeft = Math.max(1000, d.clockEnd - now); d.clockEnd = null; break;
      case 'resume': only(); if (d.status !== 'paused') throw new HttpsError('failed-precondition', 'Not paused.'); d.status = 'live'; d.clockEnd = now + (d.pausedLeft || d.clockSec * 1000); d.pausedLeft = null; break;
      case 'undo': {
        only(); if (!d.picks.length) throw new HttpsError('failed-precondition', 'No picks to undo.');
        if (d.official) throw new HttpsError('failed-precondition', 'Unmark the draft as official first.');
        d.picks.pop();
        if (d.status === 'done') d.status = 'paused';           // reopened drafts wait for the commissioner to resume
        if (d.status === 'paused') d.pausedLeft = d.clockSec * 1000; else advance(d, now);
        break;
      }
      // Official: this draft's picks become the league's rosters (league/rosters), replacing any earlier official draft.
      case 'official': {
        only(); if (d.status !== 'done') throw new HttpsError('failed-precondition', 'Finish the draft first.');
        if (data.on) extra.push(...await officialWrites(tx, db, id, d, now, uid));
        else {
          const L = (await tx.get(db.doc('league/rosters'))).data();
          if (d.kind === 'rookie' && L && (L.rookieDrafts || []).includes(id)) throw new HttpsError('failed-precondition', "This rookie draft's players are already on the rosters. Remove them with roster moves instead.");
          const C = (await tx.get(db.doc('config/season'))).data() || {};
          if (C.founding && L && L.source === id) throw new HttpsError('failed-precondition', "This draft made the league's rosters. Unmarking it would erase every roster, so it stays official.");
          d.official = false; if (L && L.source === id) extra.push([db.doc('league/rosters'), null]);
        }
        break;
      }
      case 'pick': {
        if (d.status !== 'live') throw new HttpsError('failed-precondition', d.status === 'paused' ? 'The draft is paused.' : 'The draft is not running.');
        if (Number(data.n) !== d.picks.length) throw new HttpsError('aborted', 'That pick was already made. The board has been updated.');
        if (!mine(team) && !commish) throw new HttpsError('permission-denied', "It isn't your pick.");
        const p = String(data.player), { ok, count } = legalFor(d, posOf, team);
        if (!posOf[p]) throw new HttpsError('invalid-argument', "That player isn't eligible in this draft.");
        if (posOf[p] === 'QB' && count('QB') >= 2) throw new HttpsError('failed-precondition', 'Your team already has 2 QBs, the most allowed (rule 8-1-4).');
        if (!ok(p)) throw new HttpsError('failed-precondition', 'That player has already been drafted.');
        d.picks.push({ p, t: team, by: mine(team) ? 'gm' : 'commish', at: now });
        advance(d, now);
        break;
      }
      case 'tick': {
        if (d.status !== 'live' || d.clockEnd == null || now < d.clockEnd - 400) return { ok: false };
        const p = autoChoice(d, pool, posOf, team, queue);
        if (!p) { d.status = 'paused'; d.pausedLeft = d.clockSec * 1000; d.clockEnd = null; break; }
        d.picks.push({ p, t: team, by: d.practice && !d.seats[String(team)] ? 'sim' : 'auto', at: now });
        advance(d, now);
        break;
      }
      default: throw new HttpsError('invalid-argument', 'Unknown action.');
    }
    if (chain && pool) await chainQueue(tx, db, id, d, pool, posOf, now, override);
    if (d.mode === 'official' && d.status === 'done' && !d.official && action !== 'official') extra.push(...await officialWrites(tx, db, id, d, now, uid));
    d.updated = now;
    tx.update(ref, { teams: d.teams, seats: d.seats, picks: d.picks, status: d.status, clockEnd: d.clockEnd ?? null, pausedLeft: d.pausedLeft ?? null,
      clockSec: d.clockSec, simDelay: d.simDelay, official: !!d.official, officialAt: d.officialAt ?? null, updated: now });
    for (const [r, v, how] of extra) { if (v === null) tx.delete(r); else if (how === 'update') tx.update(r, v); else tx.set(r, v); }
    return { ok: true };
  });
}

exports.draft = onCall({ region: 'us-central1', maxInstances: 10, timeoutSeconds: 60, memory: '512MiB' }, async req => {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const db = getFirestore();
  const [roles, user] = await Promise.all([db.doc('config/roles').get(), db.doc(`users/${uid}`).get()]);
  const commish = ((roles.data() || {}).commish || []).includes(uid), team = (user.data() || {}).team;
  return draftAct(db, uid, commish, req.data || {}, team == null ? null : team);
});

// draftClock: once a minute, make any pick whose clock ran out while nobody had the draft room open.
exports.draftClock = onSchedule({ schedule: 'every 1 minutes', region: 'us-central1', retryCount: 0, timeoutSeconds: 120, maxInstances: 1 }, async () => {
  const db = getFirestore();
  const live = await db.collection('drafts').where('status', '==', 'live').get();
  for (const doc of live.docs) {
    for (let i = 0; i < 30; i++) {
      const d = (await doc.ref.get()).data();
      if (!d || d.status !== 'live' || d.clockEnd == null || Date.now() < d.clockEnd) break;
      await draftAct(db, null, false, { action: 'tick', id: doc.id });
    }
  }
});

/* ---------- Lineups (team.html Depth Chart) ----------
   One callable, "lineup", for every lineup, IR and taxi move on the Hub's own rosters (league/rosters, written when a
   Draft Room draft is made official). Only the team's linked GM (users/{uid}.team) or a commissioner can change a team.
     league/rosters   rosters {team: [every player]}, ir {team: [...]}, taxi {team: [...]}
     league/lineups   the standing lineup {team: [14 player ids or null, in SLOTS order]}; it carries over week to week
     lineups/{season}-w{week}   that week's lineups as they stood (saved on every change, and by liveScores during games)
   Rulebook: slots 7-2-1; each player locks at his game's kickoff (7-4-2), from ESPN's scoreboard for the current week;
   24 active players (14 starters + 10 bench) plus up to 5 taxi and 4 IR (8-1-1); taxi is for rookies only, with the
   Week 4 deadline (8-1-2, not applied to practice rosters from a mock draft); IR only for players listed IR or Out
   (8-1-3); at most 2 QBs not counting taxi or IR, and a team over that can't change its lineup (8-1-4). */
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'SUPER_FLEX', 'K', 'DL', 'LB', 'DB', 'IDP_FLEX'];
const ELIG = { QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], K: ['K'], DL: ['DL'], LB: ['LB'], DB: ['DB'], IDP_FLEX: ['DL', 'LB', 'DB'] };
const ACTIVE_MAX = 24, IR_MAX = 4, TAXI_MAX = 5, TAXI_DEADLINE_WEEK = 4;
let playerMemo = null, gameMemo = null;
/* ESPN's live status for one player, matched the way the site's injury badges are (js/nfl.js): same normalized name,
   and if more than one player shares it, the one on the team ESPN names; never a guess. null when ESPN doesn't list
   him or the match is ambiguous. */
const injNorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.'’`-]/g, '')
  .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim();
const INJ_LIVE = { Out: 'Out', Questionable: 'Questionable', Doubtful: 'Doubtful', 'Injured Reserve': 'IR', Suspension: 'Sus', Active: null };
let injMemo = null;
async function espnInjuries() {
  if (injMemo && Date.now() - injMemo.at < 5 * 60e3) return injMemo.v;
  const v = await getJSON(`${ESPN_NFL}/injuries`); injMemo = { at: Date.now(), v }; return v;
}
// What freezes a team's lineup (Sleeper's way; rules 8-1-1, 8-1-3, 8-1-4): more than 24 active players, more than 2
// active QBs, or a player on IR who is no longer listed IR or Out. The team keeps everyone and its lineup as it stands
// still plays; it just can't change starters until it fixes the problem. kind "ir" also blocks new transactions (8-1-3).
async function rosterProblems(R, team, P) {
  const all = (R.rosters || {})[team] || [], ir = (R.ir || {})[team] || [], taxi = (R.taxi || {})[team] || [], out = [];
  const active = all.filter(id => !ir.includes(id) && !taxi.includes(id)), nm = id => (P[id] ? P[id].name : id);
  if (active.length > ACTIVE_MAX) out.push({ kind: 'size', msg: `${active.length} active players (the most is ${ACTIVE_MAX}): drop ${active.length - ACTIVE_MAX} or move rookies to the taxi squad` });
  const q = active.filter(id => P[id] && P[id].pos === 'QB').length;
  if (q > 2) out.push({ kind: 'qb', msg: `${q} active QBs (the most is 2): move one to taxi or IR, or drop one` });
  for (const id of ir) {
    if (['IR', 'Out'].includes(P[id] && P[id].inj)) continue;
    let live; try { live = await espnInjury(P, id); } catch (e) { continue; }    // ESPN unreachable: never freeze on a guess
    if (!['IR', 'Out'].includes(live)) out.push({ kind: 'ir', msg: `${nm(id)} is on IR but listed ${live || (P[id] && P[id].inj) || 'healthy'}: activate or drop him` });
  }
  return out;
}
const frozenMsg = list => `Your lineup is frozen until you fix this: ${list.map(x => x.msg).join('; ')}. Your current lineup still plays (rules 8-1-1, 8-1-3, 8-1-4).`;

// Rule 6-1-3: after the founding Season, a team whose dues for the League's season aren't fully in the ledger (dues and
// prepays, not voided) once they're due (the season's rookie draft has started, or its games have) can't trade, add,
// claim, drop or move players, or make draft picks. Setting a lineup is still allowed.
const FOUNDING_SEASON = 2027;
async function unpaidTeams(db, cal) {
  if (!(cal.season > FOUNDING_SEASON && cal.duesDue)) return new Set();
  const [lg, led, ro] = await Promise.all([getJSON(`${SITE}/data/league.json?t=${Date.now()}`).catch(() => ({})),
    db.collection('ledger').where('season', '==', cal.season).get(), db.doc('league/rosters').get()]);
  const dues = Number((lg.prizes || {}).buyIn) || 100, all = led.docs.map(d => ({ id: d.id, ...d.data() }));
  const voided = new Set(all.filter(e => e.kind === 'void').map(e => e.ref)), paid = {};
  for (const e of all) if (!voided.has(e.id) && ['dues', 'prepay'].includes(e.kind)) paid[String(e.team)] = (paid[String(e.team)] || 0) + Number(e.amount || 0);
  return new Set(Object.keys((ro.data() || {}).rosters || {}).filter(t => (paid[t] || 0) < dues));
}
const unpaidMsg = season => `Your ${season} dues aren't in the ledger yet. Until they're paid you can't trade, add, claim, drop or move players, or make draft picks (rule 6-1-3). You can still set your lineup.`;

async function espnInjury(P, id) {
  const me = P[id]; if (!me) return null;
  const k = injNorm(me.name), same = Object.keys(P).filter(x => injNorm(P[x].name) === k);
  const inj = await espnInjuries();
  for (const t of inj.injuries || []) for (const x of t.injuries || []) {
    const a = x.athlete || {};
    if (injNorm(a.displayName) !== k || !x.status) continue;
    const team = ({ WSH: 'WAS' })[(a.team || {}).abbreviation] || (a.team || {}).abbreviation || null;
    const pick = same.length === 1 ? same[0] : (same.filter(s => team && P[s].team === team).length === 1 ? same.find(s => P[s].team === team) : null);
    if (pick !== id) continue;
    return x.status in INJ_LIVE ? INJ_LIVE[x.status] : x.status;
  }
  return null;
}
async function playerInfo() {
  if (playerMemo && Date.now() - playerMemo.at < 10 * 60000) return playerMemo.v;
  const all = await getJSON(`${SITE}/data/players.json?t=${Date.now()}`), v = {};
  for (const [id, p] of Object.entries(all)) {
    const g = (p.fantasy_positions || []).find(x => IDP_POS.includes(x)) || IDPMAP[p.position];
    v[id] = { pos: DRAFT_POS.includes(p.position) ? p.position : g || p.position, team: p.team || null, inj: p.injury_status || null, exp: p.years_exp, name: p.full_name || id };
  }
  playerMemo = { at: Date.now(), v }; return v;
}
// This week's kickoff per NFL team, from ESPN (a game that has started or finished locks its players).
async function weekGames() {
  if (gameMemo && Date.now() - gameMemo.at < 60000) return gameMemo.v;
  // Locks only count in the regular season (ESPN season type 2): preseason, NFL playoff and offseason games lock nobody.
  // Once every game of the week is final, the week is over: nothing is locked and lineups are for the next week (ESPN
  // itself only moves to the next week at 2 AM Central Wednesday).
  const sb = await getJSON(`${ESPN_NFL}/scoreboard`), byTeam = {}, events = sb.events || [];
  const type = Number((sb.season || {}).type || 0), regular = type === 2;
  const over = events.length > 0 && events.every(e => e.status.type.state === 'post');
  if (regular && !over) for (const e of events) {
    const c = e.competitions[0], started = e.status.type.state !== 'pre' || Date.parse(e.date) <= Date.now();
    for (const t of c.competitors) { const a = TEAMFIX[t.team.abbreviation] || t.team.abbreviation; byTeam[a] = { at: e.date, started }; }
  }
  const v = { season: String((sb.season || {}).year || ''), week: Number((sb.week || {}).number || 0) + (regular && over ? 1 : 0), type, regular, byTeam };
  gameMemo = { at: Date.now(), v }; return v;
}

async function lineupAct(db, uid, commish, myTeam, data) {
  if (data.action === 'results') {                     // commissioner: score a week now (see weekResults)
    if (!commish) throw new HttpsError('permission-denied', 'Only the commissioner can do that.');
    const week = parseInt(data.week, 10), season = String(data.season || (await getJSON('https://api.sleeper.app/v1/state/nfl')).season);   // the NFL season (Jan games belong to the year before)
    if (!(week >= 1 && week <= 18)) throw new HttpsError('invalid-argument', 'Pick a week from 1 to 18.');
    const R = (await db.doc('league/rosters').get()).data() || {}, start = startFor(R, season), files = await leagueFiles();
    const current = Number((await getJSON('https://api.sleeper.app/v1/state/nfl')).week);
    const bracket = week > REG_WEEKS ? await updateBracket(db, season, start, files, current) : null;
    const r = await scoreWeek(db, season, week, start, { files, bracket });
    await updateBracket(db, season, start, files, current);
    if (!r) return { ok: true, week, skipped: week > REG_WEEKS ? 'That playoff round has no matchups yet.' : 'That placeholder week already has scores.' };
    return { ok: true, week: r.week, final: r.final, official: r.official, hub: r.hub, teams: Object.keys(r.teams).length };
  }
  const team = String(parseInt(data.team, 10));
  if (!commish && String(myTeam) !== team) throw new HttpsError('permission-denied', 'You can only set your own team.');
  const [P, G] = await Promise.all([playerInfo(), weekGames()]);
  const locked = id => !!(id && P[id] && P[id].team && G.byTeam[P[id].team] && G.byTeam[P[id].team].started);
  const nm = id => (P[id] ? P[id].name : id);
  // Checked before the transaction (they read ESPN and the ledger): a frozen lineup, and unpaid dues for roster moves.
  const problems = data.action === 'set' ? await rosterProblems((await db.doc('league/rosters').get()).data() || {}, team, P) : [];
  if (data.action === 'move' && !(commish && String(myTeam) !== team)) {
    const cal = await leagueCalendar(db, await getJSON('https://api.sleeper.app/v1/state/nfl'));
    if ((await unpaidTeams(db, cal)).has(team)) throw new HttpsError('failed-precondition', unpaidMsg(cal.season));
  }
  return db.runTransaction(async tx => {
    const rRef = db.doc('league/rosters'), lRef = db.doc('league/lineups'), snapRef = db.doc(`lineups/${G.season || 'x'}-w${G.week}`);
    const [rs, ls, snap] = await Promise.all([tx.get(rRef), tx.get(lRef), tx.get(snapRef)]);
    const R = rs.data(); if (!R || !R.rosters || !R.rosters[team]) throw new HttpsError('failed-precondition', 'There are no league rosters yet. Make a draft official first.');
    const L = ls.data() || { teams: {} };
    const all = R.rosters[team], ir = (R.ir || {})[team] || [], taxi = (R.taxi || {})[team] || [];
    const active = all.filter(id => !ir.includes(id) && !taxi.includes(id));
    const cur = ((L.teams || {})[team] || SLOTS.map(() => null)).map(id => (id && active.includes(id) ? id : null));
    while (cur.length < SLOTS.length) cur.push(null);
    const qbs = list => list.filter(id => P[id] && P[id].pos === 'QB').length;
    let slots = cur.slice(), newIr = ir.slice(), newTaxi = taxi.slice();
    if (data.action === 'set') {
      if (problems.length) throw new HttpsError('failed-precondition', frozenMsg(problems));
      const want = (data.slots || []).slice(0, SLOTS.length).map(x => (x ? String(x) : null)); while (want.length < SLOTS.length) want.push(null);
      const seen = new Set();
      want.forEach((id, i) => {
        if (!id) return;
        if (!active.includes(id)) throw new HttpsError('invalid-argument', `${nm(id)} isn't on your active roster.`);
        if (seen.has(id)) throw new HttpsError('invalid-argument', `${nm(id)} is in two spots.`); seen.add(id);
        if (!P[id] || !ELIG[SLOTS[i]].includes(P[id].pos)) throw new HttpsError('invalid-argument', `${nm(id)} can't play ${SLOTS[i]}.`);
      });
      want.forEach((id, i) => {
        if (id === cur[i]) return;
        if (locked(cur[i])) throw new HttpsError('failed-precondition', `${nm(cur[i])}'s game has started; he's locked in (rule 7-4-2).`);
        if (locked(id)) throw new HttpsError('failed-precondition', `${nm(id)}'s game has started; he can't be moved in now (rule 7-4-2).`);
      });
      slots = want;
    } else if (data.action === 'move') {
      const id = String(data.player || ''), to = data.to;
      if (!all.includes(id)) throw new HttpsError('invalid-argument', "That player isn't on your roster.");
      const i = slots.indexOf(id);
      if (i >= 0 && locked(id)) throw new HttpsError('failed-precondition', `${nm(id)} is starting and his game has started (rule 7-4-2).`);
      if (to === 'ir') {
        if (ir.includes(id)) throw new HttpsError('failed-precondition', `${nm(id)} is already on IR.`);
        if (!['IR', 'Out'].includes(P[id] && P[id].inj)) {
          const live = await espnInjury(P, id).catch(() => null);  // the nightly list can lag ESPN by a day
          if (!['IR', 'Out'].includes(live)) throw new HttpsError('failed-precondition', `Only players listed IR or Out can go on IR (rule 8-1-3). ${nm(id)} is listed ${live || (P[id] && P[id].inj) || 'healthy'}.`);
        }
        if (ir.length >= IR_MAX) throw new HttpsError('failed-precondition', `IR is full (${IR_MAX} spots).`);
        newTaxi = taxi.filter(x => x !== id); newIr = [...ir, id];
      } else if (to === 'taxi') {
        if (taxi.includes(id)) throw new HttpsError('failed-precondition', `${nm(id)} is already on the taxi squad.`);
        // One way (8-1-2): a player promoted off any taxi squad never goes back on one, on any team.
        if ((R.promoted || []).includes(id)) throw new HttpsError('failed-precondition', `${nm(id)} was promoted off a taxi squad; once promoted, a player can't go back on one (rule 8-1-2).`);
        if (!(P[id] && P[id].exp === 0)) throw new HttpsError('failed-precondition', `Only rookies can be placed on the taxi squad (rule 8-1-2).`);
        // Closed after Week 4 of the regular season and through the NFL playoffs; open again in the offseason for the rookie draft.
        if (!R.practice && ((G.regular && G.week > TAXI_DEADLINE_WEEK) || G.type === 3)) throw new HttpsError('failed-precondition', `The taxi deadline (Week ${TAXI_DEADLINE_WEEK}) has passed (rule 8-1-2).`);
        if (taxi.length >= TAXI_MAX) throw new HttpsError('failed-precondition', `The taxi squad is full (${TAXI_MAX} spots).`);
        newIr = ir.filter(x => x !== id); newTaxi = [...taxi, id];
      } else if (to === 'active') {
        if (!ir.includes(id) && !taxi.includes(id)) throw new HttpsError('failed-precondition', `${nm(id)} is already active.`);
        if (active.length >= ACTIVE_MAX) throw new HttpsError('failed-precondition', `Your active roster is full (${ACTIVE_MAX}). Move someone to IR or taxi first; releasing players comes with waivers.`);
        newIr = ir.filter(x => x !== id); newTaxi = taxi.filter(x => x !== id);
        const nowActive = [...active, id];
        if (P[id] && P[id].pos === 'QB' && qbs(nowActive) > 2) throw new HttpsError('failed-precondition', 'That would make 3 active QBs; the most allowed is 2 (rule 8-1-4).');
      } else throw new HttpsError('invalid-argument', 'Unknown move.');
      if (i >= 0 && to !== 'active') slots[i] = null;
    } else throw new HttpsError('invalid-argument', 'Unknown action.');
    const now = Date.now();
    tx.set(lRef, { teams: { [team]: slots }, season: G.season, week: G.week, updated: now }, { merge: true });
    // The week's own record only in the regular season (so a January change can't touch last season's Week 1), with
    // every spot whose player has kicked off kept as it was.
    if (G.regular && G.season) tx.set(snapRef, { teams: { [team]: freeze(((snap.data() || {}).teams || {})[team], slots, locked) }, season: G.season, week: G.week, updated: now }, { merge: true });
    if (data.action === 'move') tx.update(rRef, { [`ir.${team}`]: newIr, [`taxi.${team}`]: newTaxi,
      ...(taxi.includes(String(data.player)) && data.to !== 'taxi' ? { promoted: FieldValue.arrayUnion(String(data.player)) } : {}) });
    return { ok: true, slots, ir: newIr, taxi: newTaxi };
  });
}

exports.lineup = onCall({ region: 'us-central1', maxInstances: 10, timeoutSeconds: 30, memory: '512MiB' }, async req => {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const db = getFirestore();
  const [roles, user] = await Promise.all([db.doc('config/roles').get(), db.doc(`users/${uid}`).get()]);
  const commish = ((roles.data() || {}).commish || []).includes(uid), team = (user.data() || {}).team;
  const d = req.data || {}, target = String(parseInt(d.team, 10));
  // Commissioner edit: the commissioner may set another team's lineup or roster (the Commissioner's Office sets an
  // abandoned Franchise's lineups, 11-2-1), but only with Commissioner edit switched on for that team, and every change is
  // logged as a "Commissioner" transaction on that team for the whole league to see.
  const override = d.action !== 'results' && commish && String(team) !== target;
  if (override && d.override !== true) throw new HttpsError('failed-precondition', 'Turn on Commissioner edit for this team first.');
  const res = await lineupAct(db, uid, commish, team == null ? null : team, d);
  if (override) {
    const P = await playerInfo(), nm = id => (P[id] ? P[id].name : id);
    const what = d.action === 'set' ? 'Lineup set by the Commissioner'
      : d.action === 'move' ? `Commissioner moved ${nm(d.player)} to ${({ ir: 'injured reserve', taxi: 'the taxi squad', bench: 'the bench' })[d.to] || d.to}`
      : `Commissioner roster change (${String(d.action || '')})`;
    const week = Number((await getJSON('https://api.sleeper.app/v1/state/nfl')).week) || 0;
    await db.collection('transactions').add({ type: 'commissioner', status: 'complete', leg: week, created: Date.now(), roster_ids: [Number(target)],
      adds: {}, drops: {}, draft_picks: [], settings: { note: what }, by: uid });
  }
  return res;
});

// lineupCheck: Thursday and Sunday at 9 AM Central in the regular season, a private message (and phone notification) to
// each GM whose lineup has an empty spot or a starter who can't play this week: listed Out, on IR or suspended, on a bye,
// or without an NFL team. Spots already locked are left alone. Nobody with a clean lineup hears anything.
exports.lineupCheck = onSchedule({ schedule: '0 9 * * 0,4', timeZone: 'America/Chicago', region: 'us-central1', retryCount: 0, timeoutSeconds: 120, memory: '512MiB' }, async () => {
  const G = await weekGames(); if (!G.regular || G.week > REG_WEEKS + 3) return;
  const db = getFirestore(), [rs, ls, us, br] = await Promise.all([db.doc('league/rosters').get(), db.doc('league/lineups').get(), db.collection('users').get(), db.doc('league/bracket').get()]);
  const R = rs.data(); if (!R || !R.rosters) return;
  const P = await playerInfo(), L = (ls.data() || {}).teams || {};
  // In the playoffs only the teams still playing that week get the reminder.
  const B = br.data() || {}, rd = (B.rounds || []).find(r => r.week === G.week);
  const playing = G.week > REG_WEEKS ? new Set(rd ? rd.games.flatMap(g => [g.a, g.b]).filter(Boolean).map(String) : []) : null;
  for (const t of Object.keys(R.rosters)) {
    if (playing && !playing.has(t)) continue;
    const slots = L[t] || SLOTS.map(() => null), issues = [];
    slots.forEach((id, i) => {
      if (!id) { issues.push(`${SLOTS[i].replace('_', ' ')} is empty`); return; }
      const p = P[id], g = p && p.team && G.byTeam[p.team];
      if (g && g.started) return;
      const nm = p ? p.name : `Player ${id}`;
      if (!p || !p.team) issues.push(`${nm} has no NFL team`);
      else if (!g) issues.push(`${nm} is on a bye`);
      else if (['Out', 'IR', 'Sus', 'PUP'].includes(p.inj)) issues.push(`${nm} is listed ${p.inj}`);
    });
    for (const x of await rosterProblems(R, t, P)) issues.unshift(`lineup frozen: ${x.msg}`);
    if (!issues.length) continue;
    for (const u of us.docs.filter(u => String(u.data().team) === t))
      await db.collection('notes').add({ to: u.id, team: Number(t), by: 'system', at: FieldValue.serverTimestamp(), title: `Week ${G.week} lineup check`,
        body: `${issues.join('; ')}. Set your lineup on your team's Depth Chart before kickoff.` });
  }
});

/* ---------- Week results, standings and the playoff bracket ----------
   results/{season}-w{week}: each team's score for the week, from its Hub lineup (lineups/{season}-w{week}, else the
   standing lineup) scored with that week's NFL stats (Sleeper's feed, which carries the NFL's stat corrections) in League
   scoring (data/scoring.json).  {season, week, final, official, hub, kind: regular|playoff, teams: {team: {opp, pts, starters, points}}}
     final    = every NFL game that week is over
     official = rule 2-2-3: 5 AM Central on the Tuesday after the week's last game. An official week is never scored again;
                stat corrections before then count, later ones don't (7-3-3).
   Regular season (Weeks 1-14): pairs from the Hub's schedule (data/schedule.json). Weeks before league/rosters.startWeek
   belong to the placeholder league (data/sample/matchups.json) and keep their scores.
   Playoffs (rule 7-1-2), NFL style: the three division winners are seeds 1-3 (by record, ties by points for), the three
   best other records are the wild cards, seeds 4-6; seeds 1-2 get a bye. Week 15, the wild card round: 3 v 6, 4 v 5. Week 16, the divisional round (reseeded):
   seed 1 plays the lowest seed left, seed 2 the other. Week 17: the championship and the third-place game (6-3-4). A tied
   playoff game goes to the higher seed.
   league/bracket: the seeds and every playoff game, rewritten each run, so it moves with the standings during the season
   (a projection until Week 14 is official) and fills in as playoff weeks go official.
   weekResults runs at 5:00 AM Central every day; the commissioner can also score any week now (lineup, action "results"). */
const REG_WEEKS = 14, PLAYOFF_TEAMS = 6;
const chiParts = ms => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', hourCycle: 'h23' })
  .formatToParts(new Date(ms)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
function chiTime(y, m, d, h) { const guess = Date.UTC(y, m - 1, d, h), p = chiParts(guess); return guess + (guess - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour)); }
// 5 AM Central on the first Tuesday after the week's last kickoff (rule 2-2-3).
function officialAt(lastKick) {
  for (let i = 0; i < 9; i++) { const p = chiParts(lastKick + i * 864e5); if (p.weekday === 'Tue') { const at = chiTime(+p.year, +p.month, +p.day, 5); if (at > lastKick + 3 * 3600e3) return at; } }
  return lastKick + 7 * 864e5;
}
async function leagueFiles() {
  const t = Date.now();
  const [schedule, sample, fr] = await Promise.all([getJSON(`${SITE}/data/schedule.json?t=${t}`), getJSON(`${SITE}/data/sample/matchups.json?t=${t}`), getJSON(`${SITE}/data/franchises.json?t=${t}`)]);
  const divOf = Object.fromEntries(Object.entries(fr.franchises || {}).map(([rid, f]) => [Number(rid), f.division]));
  return { schedule, sample, divOf };
}
const samplePts = (sample, w, t) => ((sample[String(w)] || []).find(m => m.roster_id === Number(t)) || {}).points || 0;

// Regular-season standings from the Hub's results (official weeks only) and the placeholder weeks' scores.
// The first Hub-scored week of a season: the start week in the season the rosters were made, Week 1 in every later one.
// Placeholder weeks only ever exist in the 2026 test season (rosters saved before startSeason was recorded count as 2026).
const SAMPLE_SEASON = 2026;
const startFor = (R, season) => (Number(season) > Number((R && R.startSeason) || SAMPLE_SEASON) ? 1 : (R && R.startWeek) || 99);
function standingsFrom(season, files, results, startWeek, current = 99) {
  const weeks = (files.schedule[String(season)] || {}).weeks || {}, out = {};
  const T = t => (out[t] = out[t] || { team: Number(t), w: 0, l: 0, t: 0, pf: 0, pa: 0, gp: 0 });
  for (let w = 1; w <= REG_WEEKS; w++) {
    const R = results[w], hubWeek = w >= startWeek;
    if (hubWeek ? !(R && R.official) : (w >= current || !(files.sample[String(w)] || []).some(m => m.points))) continue;   // placeholder weeks count once played
    for (const [a, b] of weeks[String(w)] || []) {
      const pa = hubWeek ? ((R.teams[String(a)] || {}).pts || 0) : samplePts(files.sample, w, a);
      const pb = hubWeek ? ((R.teams[String(b)] || {}).pts || 0) : samplePts(files.sample, w, b);
      for (const [x, px, py] of [[a, pa, pb], [b, pb, pa]]) { const s = T(x); s.gp++; s.pf += px; s.pa += py; if (px > py) s.w++; else if (px < py) s.l++; else s.t++; }
    }
  }
  return Object.values(out).map(s => ({ ...s, pf: Math.round(s.pf * 100) / 100, pa: Math.round(s.pa * 100) / 100 }))
    .sort((x, y) => (y.w + y.t / 2) - (x.w + x.t / 2) || y.pf - x.pf);
}
// Seeding, NFL style (rule 7-1-2): the three division winners are seeds 1-3 by record (ties: points for), whatever a
// wild card's record; the three best of the rest are the wild cards, seeds 4-6. Seeds 1 and 2 get the byes.
const better = (x, y) => (y.w + y.t / 2) - (x.w + x.t / 2) || y.pf - x.pf;
function seedsFrom(standings, divOf) {
  const byDiv = {}; for (const s of standings) (byDiv[divOf[s.team] || 'none'] = byDiv[divOf[s.team] || 'none'] || []).push(s);
  const winners = Object.values(byDiv).map(list => list.slice().sort(better)[0]).sort(better);
  const wild = standings.filter(s => !winners.includes(s)).sort(better).slice(0, PLAYOFF_TEAMS - winners.length);
  return [...winners.map(s => ({ ...s, how: 'Division winner' })), ...wild.map(s => ({ ...s, how: 'Wild card' }))].map((s, i) => ({ ...s, seed: i + 1 }));
}
// The bracket: seeds from the standings, then each playoff round from the results already in.
function bracketFrom(season, standings, results, divOf = {}) {
  const seeds = seedsFrom(standings, divOf), seedOf = t => (seeds.find(s => s.team === t) || {}).seed;
  const regDone = (() => { for (let w = 1; w <= REG_WEEKS; w++) if (!(standings.length && standings[0].gp >= w)) return false; return true; })();
  const game = (week, a, b, label) => {
    const R = results[week], ok = !!(R && R.official && a && b);
    const pa = R && a ? ((R.teams[String(a)] || {}).pts ?? null) : null, pb = R && b ? ((R.teams[String(b)] || {}).pts ?? null) : null;
    const winner = ok ? (pa > pb ? a : pb > pa ? b : (seedOf(a) < seedOf(b) ? a : b)) : null;
    return { week, label, a, b, aSeed: seedOf(a) || null, bSeed: seedOf(b) || null, aPts: pa, bPts: pb, final: ok, winner, loser: winner ? (winner === a ? b : a) : null };
  };
  const s = n => (seeds[n - 1] || {}).team || null;
  const qf = [game(REG_WEEKS + 1, s(3), s(6), 'Wild card round'), game(REG_WEEKS + 1, s(4), s(5), 'Wild card round')];
  const alive = qf.every(g => g.final) ? qf.map(g => g.winner).sort((x, y) => seedOf(y) - seedOf(x)) : [null, null];   // lowest seed first
  const sf = [game(REG_WEEKS + 2, s(1), alive[0], 'Divisional round'), game(REG_WEEKS + 2, s(2), alive[1], 'Divisional round')];
  const sfDone = sf.every(g => g.final);
  const fin = [game(REG_WEEKS + 3, sfDone ? sf[0].winner : null, sfDone ? sf[1].winner : null, 'Blitz Bowl'), game(REG_WEEKS + 3, sfDone ? sf[0].loser : null, sfDone ? sf[1].loser : null, 'Third-place game')];
  return { season: String(season), projected: !regDone, seeds, rounds: [{ week: REG_WEEKS + 1, name: 'Wild card round', byes: [s(1), s(2)], games: qf }, { week: REG_WEEKS + 2, name: 'Divisional round', games: sf }, { week: REG_WEEKS + 3, name: 'Championship', games: fin }],
    champion: fin[0].winner, runnerUp: fin[0].loser, third: fin[1].winner, updated: Date.now() };
}

async function scoreWeek(db, season, week, startWeek, ctx = {}) {
  const ref = db.doc(`results/${season}-w${week}`), prev = (await ref.get()).data();
  if (prev && prev.official) return prev;                                   // official weeks never change (2-2-3)
  const files = ctx.files || await leagueFiles();
  const [scoring, rows, sb, L, snap] = await Promise.all([
    leagueScoring(season, week),
    getJSON(`https://api.sleeper.com/stats/nfl/${season}/${week}?season_type=regular&t=${Date.now()}`),
    getJSON(`${ESPN_NFL}/scoreboard?seasontype=2&week=${week}&dates=${season}`),
    db.doc('league/lineups').get().then(d => d.data() || {}),
    db.doc(`lineups/${season}-w${week}`).get().then(d => d.data() || {}),
  ]);
  const playoff = week > REG_WEEKS, hubWeek = week >= startWeek;
  if (!playoff && !hubWeek && (files.sample[String(week)] || []).some(m => m.points)) return null;   // placeholder week with scores
  let pairs;
  if (playoff) {
    const br = ctx.bracket; if (!br || br.projected) return null;
    pairs = (br.rounds.find(r => r.week === week) || { games: [] }).games.filter(g => g.a && g.b).map(g => [g.a, g.b]);
    if (!pairs.length) return null;
  } else pairs = ((files.schedule[String(season)] || {}).weeks || {})[String(week)] || [];
  const pts = {};
  for (const r of rows) {
    const st = r.stats || {}; if (!/^\d+$/.test(String(r.player_id))) continue;
    pts[r.player_id] = Math.round(Object.entries(scoring).reduce((t, [k, v]) => t + (typeof st[k] === 'number' ? v * st[k] : 0), 0) * 100) / 100;
  }
  const events = sb.events || [], final = events.length > 0 && events.every(e => e.status.type.state === 'post');
  const lastKick = Math.max(0, ...events.map(e => Date.parse(e.date)));
  const placeholder = Object.fromEntries((files.sample[String(week)] || []).map(m => [String(m.roster_id), m.starters || []]));
  const lineupOf = t => (hubWeek ? ((snap.teams || {})[t] || (L.teams || {})[t] || []) : placeholder[t] || []);
  const teams = {};
  for (const [a, b] of pairs) for (const [t, o] of [[a, b], [b, a]]) {
    const starters = lineupOf(String(t)).map(x => x || null), points = starters.map(x => (x ? pts[x] || 0 : 0));
    teams[String(t)] = { opp: o, pts: Math.round(points.reduce((x, y) => x + y, 0) * 100) / 100, starters, points };
  }
  const official = final && lastKick > 0 && Date.now() >= officialAt(lastKick);
  const doc = { season: String(season), week: Number(week), kind: playoff ? 'playoff' : 'regular', final, official, officialAt: lastKick ? officialAt(lastKick) : null, hub: hubWeek, teams, at: Date.now() };
  await ref.set(doc);
  return doc;
}

// Recompute the bracket from everything recorded so far and save it.
async function updateBracket(db, season, startWeek, files, current) {
  const res = await db.collection('results').where('season', '==', String(season)).get(), results = {};
  for (const d of res.docs) { const r = d.data(); results[r.week] = r; }
  const br = bracketFrom(season, standingsFrom(season, files, results, startWeek, current), results, files.divOf);
  await db.doc('league/bracket').set(br);
  return br;
}

exports.weekResults = onSchedule({ schedule: '0 5 * * *', timeZone: 'America/Chicago', region: 'us-central1', retryCount: 1, timeoutSeconds: 180, memory: '512MiB', maxInstances: 1 }, async () => {
  const db = getFirestore(), rRef = db.doc('league/rosters'), R = (await rRef.get()).data();
  if (!R) return;                                                          // no Hub league yet
  const state = await getJSON('https://api.sleeper.app/v1/state/nfl');
  // Only while NFL games are being played (regular season, and the NFL playoffs while Week 17 waits to go official):
  // in the preseason and offseason there is nothing to score, and no empty week gets written.
  if (!['regular', 'post'].includes(state.season_type)) return;
  const season = String(state.season), week = Number(state.week), files = await leagueFiles();
  if (!R.startWeek) { R.startWeek = week + 1; R.startSeason = Number(season); await rRef.update({ startWeek: R.startWeek, startSeason: R.startSeason }); }   // rosters made official mid-week: next week
  const start = startFor(R, season);
  // This week and the two before it, oldest first, so a playoff round sees the round before it once it is official.
  for (const w of [week - 2, week - 1, week]) {
    if (w < 1 || w > REG_WEEKS + 3) continue;
    const bracket = w > REG_WEEKS ? await updateBracket(db, season, start, files, week) : null;
    await scoreWeek(db, season, w, start, { files, bracket });
  }
  await updateBracket(db, season, start, files, week);
});
/* ---------- Waivers and free agents (rule 8-4) ----------
   One callable, "moves": add a free agent, drop a player, place or cancel a blind FAAB claim. movesRun settles claims on Wednesdays.
     league/waivers     players: {id: {until: ms, from: team}}  (a dropped player sits on waivers for two days, 8-4-1)
     league/faab        spent: {team: dollars}, season          ($100 a season, never carried over, 8-4-2)
     claims/{id}        {team, player, bid, drop, at, status: pending | won | lost | failed | cancelled, note}
                        blind: only that team's GM and the commissioners can read it (firestore.rules)
     transactions/{id}  every completed add / drop / claim, in Sleeper's transaction format (team pages show them)
   Rules checked here: the player is a free agent (or on waivers for a claim); 24 active players after the move (a full
   roster names a player to drop); at most 2 active QBs (8-1-4); a player whose game this week has kicked off can't be
   dropped until next week; no adds in the offseason (8-4-3); bids are whole dollars from $1 to what's left of the budget.
   Ties: the team with the worse record (fewer wins, then fewer points) wins; still tied, the earlier claim. */
const FAAB_BUDGET = 100, WAIVER_MS = 2 * 864e5;
const ownerOf = (R, id) => Object.keys(R.rosters || {}).find(t => (R.rosters[t] || []).includes(id)) || null;
// A dropped player stays on waivers at least two days (8-4-1) and clears in the Wednesday 3 AM batch after that.
const waiverClears = from => nextBatch(from + WAIVER_MS);

// The League's season calendar, from the League's own record rather than Sleeper's (whose season changes on its own
// schedule). Once the Blitz Bowl is final, the League is in the next season: the Offseason (rule definitions) runs from
// then until that season's rookie draft starts.
async function leagueCalendar(db, state) {
  const br = (await db.doc('league/bracket').get()).data() || {}, nfl = Number(state.season);
  const done = !!br.champion && Number(br.season) >= nfl;            // this NFL season's Blitz Bowl is final
  const season = done ? Number(br.season) + 1 : nfl;
  const drafts = (await db.collection('drafts').where('pickSeason', '==', season).get()).docs.map(d => d.data());
  const rookieStarted = drafts.some(d => d.kind === 'rookie' && d.mode === 'official' && ['live', 'paused', 'done'].includes(d.status));
  const R = (await db.doc('league/rosters').get()).data() || {};
  const rookieDone = rookieStarted || (R.rookieSeasons || []).map(Number).includes(season);
  // Picks that can be traded (8-3-1): this season's, until its rookie draft starts and while its games haven't begun,
  // and the next three seasons'.
  const begun = String(state.season) === String(season) && ['regular', 'post'].includes(state.season_type);
  const pickSeasons = [...(!rookieDone && !begun ? [season] : []), season + 1, season + 2, season + 3];
  return { season, offseason: done && !rookieStarted, pickSeasons, duesDue: rookieDone || begun };
}

// Apply an add and/or drop to the roster doc's data (mutates R and the standing lineups LU); returns the changes made.
function rosterMove(R, LU, team, add, drop, P, locked, allowOver = false) {
  const all = R.rosters[team] || (R.rosters[team] = []), ir = ((R.ir = R.ir || {})[team] = R.ir[team] || []), taxi = ((R.taxi = R.taxi || {})[team] = R.taxi[team] || []);
  const nm = id => (P[id] ? P[id].name : id);
  if (drop) {
    if (!all.includes(drop)) throw new HttpsError('failed-precondition', `${nm(drop)} isn't on your roster.`);
    if (locked(drop)) throw new HttpsError('failed-precondition', `${nm(drop)}'s game this week has started; he can't be dropped until next week.`);
  }
  if (add && ownerOf(R, add)) throw new HttpsError('failed-precondition', `${nm(add)} is already on a roster.`);
  const after = all.filter(x => x !== drop).concat(add ? [add] : []);
  const active = after.filter(x => !ir.includes(x) && !taxi.includes(x));
  if (add && !allowOver && active.length > ACTIVE_MAX) throw new HttpsError('failed-precondition', `Your active roster is full (${ACTIVE_MAX}). Pick a player to drop.`);
  if (add && !allowOver && P[add] && P[add].pos === 'QB' && active.filter(x => P[x] && P[x].pos === 'QB').length > 2) throw new HttpsError('failed-precondition', 'That would make 3 active QBs; the most allowed is 2 (rule 8-1-4). Drop a QB with him.');
  R.rosters[team] = after;
  if (drop) { R.ir[team] = ir.filter(x => x !== drop); R.taxi[team] = taxi.filter(x => x !== drop);
    const slots = (LU.teams = LU.teams || {})[team]; if (slots) LU.teams[team] = slots.map(x => (x === drop ? null : x)); }
}
const txDoc = (type, team, week, add, drop, bid) => ({ type, status: 'complete', leg: week, created: Date.now(), roster_ids: [Number(team)],
  adds: add ? { [add]: Number(team) } : {}, drops: drop ? { [drop]: Number(team) } : {}, draft_picks: [], settings: bid != null ? { waiver_bid: bid } : {} });

async function movesAct(db, uid, commish, myTeam, data) {
  const team = String(parseInt(data.team, 10));
  if (!commish && String(myTeam) !== team) throw new HttpsError('permission-denied', 'You can only make moves for your own team.');
  const [P, G, state] = await Promise.all([playerInfo(), weekGames(), getJSON('https://api.sleeper.app/v1/state/nfl')]);
  const locked = id => !!(id && P[id] && P[id].team && G.byTeam[P[id].team] && G.byTeam[P[id].team].started);
  const nm = id => (P[id] ? P[id].name : id);
  const add = data.player ? String(data.player) : null, drop = data.drop ? String(data.drop) : null;
  const cal = await leagueCalendar(db, state);
  if (['add', 'claim'].includes(data.action) && cal.offseason) throw new HttpsError('failed-precondition', 'No free agents may be added in the Offseason, from the Blitz Bowl until the rookie draft starts (rule 8-4-3).');
  if (add && !P[add]) throw new HttpsError('invalid-argument', "That player isn't in the NFL player list.");
  if (data.action !== 'cancel' && !(commish && String(myTeam) !== team)) {
    if ((await unpaidTeams(db, cal)).has(team)) throw new HttpsError('failed-precondition', unpaidMsg(cal.season));
    // A player on IR who is healthy again has to be activated or released before the next transaction (8-1-3).
    if (['add', 'claim'].includes(data.action)) {
      const ir = (await rosterProblems((await db.doc('league/rosters').get()).data() || {}, team, P)).filter(x => x.kind === 'ir');
      if (ir.length) throw new HttpsError('failed-precondition', `First: ${ir.map(x => x.msg).join('; ')} (rule 8-1-3).`);
    }
  }
  if (data.action === 'cancel') {
    const ref = db.doc(`claims/${String(data.claim || '').replace(/[^A-Za-z0-9-]/g, '')}`), c = (await ref.get()).data();
    if (!c || String(c.team) !== team || c.status !== 'pending') throw new HttpsError('not-found', 'No such pending claim.');
    await ref.update({ status: 'cancelled', done: Date.now() }); return { ok: true };
  }
  return db.runTransaction(async tx => {
    const rRef = db.doc('league/rosters'), wRef = db.doc('league/waivers'), lRef = db.doc('league/lineups'), fRef = db.doc('league/faab');
    const [rs, ws, ls, fs] = await Promise.all([tx.get(rRef), tx.get(wRef), tx.get(lRef), tx.get(fRef)]);
    const R = rs.data(); if (!R || !R.rosters || !R.rosters[team]) throw new HttpsError('failed-precondition', 'There are no league rosters yet.');
    const W = ws.data() || { players: {} }, LU = ls.data() || { teams: {} }, FA = fs.data() || { spent: {} };
    W.players = W.players || {};
    const onWaivers = id => !!W.players[id];                // until the Wednesday batch clears him, even past his date
    const week = G.week || Number(state.week);
    if (data.action === 'claim') {
      if (!add || !onWaivers(add)) throw new HttpsError('failed-precondition', `${nm(add)} isn't on waivers. Free agents can be added right away.`);
      const bid = parseInt(data.bid, 10), left = FAAB_BUDGET - ((FA.season === String(cal.season) ? FA.spent || {} : {})[team] || 0);
      if (!(bid >= 1)) throw new HttpsError('invalid-argument', 'The minimum bid is $1 (rule 8-4-2).');
      if (bid > left) throw new HttpsError('failed-precondition', `You have $${left} of FAAB left.`);
      if (drop && !(R.rosters[team] || []).includes(drop)) throw new HttpsError('failed-precondition', `${nm(drop)} isn't on your roster.`);
      const ref = db.doc(`claims/${team}-${add}`);
      tx.set(ref, { team: Number(team), player: add, bid, drop, at: Date.now(), until: W.players[add].until, status: 'pending', season: String(cal.season), by: uid });
      return { ok: true, claim: ref.id, until: W.players[add].until };
    }
    if (data.action === 'add') {
      if (!add) throw new HttpsError('invalid-argument', 'Pick a player.');
      if (onWaivers(add)) throw new HttpsError('failed-precondition', `${nm(add)} is on waivers until the ${new Date(W.players[add].until).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} Central waiver run. Place a claim instead.`);
      rosterMove(R, LU, team, add, drop, P, locked);
      if (W.players[add]) delete W.players[add];
    } else if (data.action === 'drop') {
      if (!drop) throw new HttpsError('invalid-argument', 'Pick a player to drop.');
      rosterMove(R, LU, team, null, drop, P, locked);
    } else throw new HttpsError('invalid-argument', 'Unknown move.');
    if (drop) W.players[drop] = { until: waiverClears(Date.now()), from: Number(team) };
    tx.set(rRef, R); tx.set(wRef, W); tx.set(lRef, LU);
    tx.set(db.collection('transactions').doc(), txDoc('free_agent', team, week, add, drop, null));
    return { ok: true, roster: R.rosters[team], ir: R.ir[team], taxi: R.taxi[team], slots: (LU.teams || {})[team] || null, waivers: W.players };
  });
}

exports.moves = onCall({ region: 'us-central1', maxInstances: 10, timeoutSeconds: 30, memory: '512MiB' }, async req => {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const db = getFirestore();
  const [roles, user] = await Promise.all([db.doc('config/roles').get(), db.doc(`users/${uid}`).get()]);
  const commish = ((roles.data() || {}).commish || []).includes(uid), team = (user.data() || {}).team;
  return movesAct(db, uid, commish, team == null ? null : team, req.data || {});
});

// Season record per team (for waiver tie-breaks): the same standings the bracket uses.
async function records(db, season) {
  const files = await leagueFiles(), R = (await db.doc('league/rosters').get()).data() || {}, current = Number((await getJSON('https://api.sleeper.app/v1/state/nfl')).week);
  const res = await db.collection('results').where('season', '==', String(season)).get(), results = {};
  for (const d of res.docs) { const r = d.data(); results[r.week] = r; }
  return Object.fromEntries(standingsFrom(season, files, results, startFor(R, season), current).map(x => [x.team, { w: x.w + x.t / 2, pf: x.pf }]));
}

// settleWaivers (in the Wednesday batch, movesRun): settle every player whose time on waivers is up. Highest bid wins (ties: worse record,
// then the earlier claim). A winning claim that no longer fits (budget, roster room, its drop) fails and the next one gets
// a turn. A player nobody wins becomes a free agent.
async function settleWaivers(db) {
  const now = Date.now(), W = (await db.doc('league/waivers').get()).data() || { players: {} };
  const due = Object.entries(W.players || {}).filter(([, v]) => v.until <= now + BATCH_SLACK).sort((a, b) => a[1].until - b[1].until).map(([id]) => id);
  if (!due.length) return { settled: 0 };
  const [P, G, state] = await Promise.all([playerInfo(), weekGames(), getJSON('https://api.sleeper.app/v1/state/nfl')]);
  const cal = await leagueCalendar(db, state), unpaid = await unpaidTeams(db, cal);
  const locked = id => !!(id && P[id] && P[id].team && G.byTeam[P[id].team] && G.byTeam[P[id].team].started);
  const rec = await records(db, state.season).catch(() => ({}));
  const nm2 = id => (P[id] ? P[id].name : id);
  let settled = 0;
  for (const id of due) {
    await db.runTransaction(async tx => {
      const rRef = db.doc('league/rosters'), wRef = db.doc('league/waivers'), lRef = db.doc('league/lineups'), fRef = db.doc('league/faab');
      const claimsQ = db.collection('claims').where('player', '==', id).where('status', '==', 'pending');
      const [rs, ws, ls, fs, cs] = await Promise.all([tx.get(rRef), tx.get(wRef), tx.get(lRef), tx.get(fRef), tx.get(claimsQ)]);
      const R = rs.data(), W2 = ws.data() || { players: {} }, LU = ls.data() || { teams: {} };
      let FA = fs.data() || {}; if (FA.season !== String(cal.season)) FA = { season: String(cal.season), spent: {} };   // $100 a season, fresh each one (8-4-2)
      if (!R || !W2.players[id] || W2.players[id].until > Date.now() + BATCH_SLACK) return;
      const claims = cs.docs.map(d => ({ ref: d.ref, ...d.data() })).sort((a, b) => (b.bid - a.bid)
        || ((rec[a.team] || {}).w || 0) - ((rec[b.team] || {}).w || 0) || ((rec[a.team] || {}).pf || 0) - ((rec[b.team] || {}).pf || 0) || a.at - b.at);
      let winner = null; const done = new Set();
      for (const c of claims) {
        const t = String(c.team), left = FAAB_BUDGET - (FA.spent[t] || 0);
        let note = null;
        // A claim you win always goes through, even past 24 active (your lineup is then frozen until you're back to 24).
        if (unpaid.has(t)) note = `${cal.season} dues unpaid (rule 6-1-3).`;
        else if (c.bid > left) note = `Not enough FAAB left ($${left}).`;
        else { try { rosterMove(R, LU, t, id, c.drop || null, P, locked, true); } catch (e) { note = e.message; } }
        if (note) { tx.update(c.ref, { status: 'failed', note, done: Date.now() }); done.add(c); continue; }
        winner = c; FA.spent[t] = (FA.spent[t] || 0) + c.bid;
        tx.update(c.ref, { status: 'won', done: Date.now() }); done.add(c);
        if (c.drop) W2.players[c.drop] = { until: waiverClears(Date.now()), from: c.team };
        tx.set(db.collection('transactions').doc(), txDoc('waiver', t, G.week, id, c.drop || null, c.bid));
        break;
      }
      for (const c of claims) if (!done.has(c)) tx.update(c.ref, { status: 'lost', note: `${nm2(id)} went to a higher bid.`, done: Date.now() });
      delete W2.players[id];
      tx.set(rRef, R); tx.set(wRef, W2); tx.set(lRef, LU); tx.set(fRef, FA);
      settled++;
    });
  }
  return { settled };
}


/* ---------- Trades (rule 8-3) ----------
   One callable, "trades": propose, cancel, reject, counter, accept, veto. movesRun processes trades whose review is over, Wednesdays.
     trades/{id}   {from, to, give: {players, picks}, get: {players, picks}, dropsFrom, dropsTo, status, at, reviewUntil, note}
                   status: offered -> accepted ("review", two days, 8-3-2) -> processed | vetoed | failed;
                           or cancelled (by the proposer) / rejected / countered (by the other team)
                   picks are {season, round, roster_id} (roster_id = the team the pick originally belonged to)
     league/picks  traded: [{season, round, roster_id, owner_id, previous_owner_id}]  (Sleeper's traded_picks format)
   Checked at acceptance and again when processed: every asset still belongs to its side; both teams stay within 24
   active players and 2 QBs after the swap and their named drops; the trade deadline (8-3-3: none accepted after the last
   game of Week 11 until the championship is final); a team trading away a pick in a future season has that season's $50
   prepay (or its dues) in the ledger (8-3-5). The commissioner can veto during review, for collusion or a rules
   violation only (8-3-4). */
const TRADE_REVIEW_MS = 2 * 864e5, TRADE_DEADLINE_WEEK = 11, PICK_SEASONS = 3, PICK_ROUNDS = 4;
const pickKey = p => `${p.season}-${p.round}-${p.roster_id}`;
function pickOwner(traded, p) { const t = (traded || []).find(x => pickKey(x) === pickKey(p)); return t ? t.owner_id : p.roster_id; }
// The deadline (8-3-3): no trade is accepted from the end of the last NFL game of Week 11 until the championship game is
// final, which rule 2-2-3 sets at 5 AM Central on the Tuesday after it (the Blitz Bowl winner in league/bracket).
async function deadlinePassed(db) {
  const sb = await getJSON(`${ESPN_NFL}/scoreboard`), week = Number((sb.week || {}).number || 0), type = Number((sb.season || {}).type || 2);
  const allPost = (sb.events || []).length > 0 && (sb.events || []).every(e => e.status.type.state === 'post');
  const after = type === 3 || (type === 2 && (week > TRADE_DEADLINE_WEEK || (week === TRADE_DEADLINE_WEEK && allPost)));
  if (!after) return { passed: false, week };
  const br = db ? (await db.doc('league/bracket').get()).data() : null;
  return { passed: !(br && br.champion), week };
}
async function prepaid(db, team, season) {
  const s = await db.collection('ledger').where('season', '==', Number(season)).get();
  const all = s.docs.map(d => ({ id: d.id, ...d.data() })), voided = new Set(all.filter(e => e.kind === 'void').map(e => e.ref));
  return all.some(e => !voided.has(e.id) && Number(e.team) === Number(team) && ['prepay', 'dues'].includes(e.kind));
}
// Check a trade against the current rosters and picks; returns the after-trade rosters (does not save).
async function checkTrade(db, T, R, picks, P, state, opts = {}) {
  const nm = id => (P[id] ? P[id].name : id), from = String(T.from), to = String(T.to);
  const own = t => R.rosters[t] || [];
  for (const [side, t] of [['give', from], ['get', to]]) {
    for (const id of T[side].players) if (!own(t).includes(id)) throw new HttpsError('failed-precondition', `${nm(id)} is no longer on that roster.`);
    for (const pk of T[side].picks) if (String(pickOwner(picks, pk)) !== t) throw new HttpsError('failed-precondition', `The ${pk.season} round ${pk.round} pick no longer belongs to that team.`);
  }
  const allowed = opts.pickSeasons || (await leagueCalendar(db, state)).pickSeasons;
  for (const pk of T.give.picks.concat(T.get.picks)) {
    if (!allowed.includes(Number(pk.season)) || !(pk.round >= 1 && pk.round <= PICK_ROUNDS)) throw new HttpsError('invalid-argument', `The ${pk.season} round ${pk.round} pick can't be traded now. Tradeable picks: ${allowed.join(', ')} (8-3-1; a season's picks stop trading when its rookie draft starts).`);
  }
  if (opts.prepay) for (const [side, t] of [['give', from], ['get', to]]) for (const season2 of new Set(T[side].picks.map(p => p.season)))
    if (!(await prepaid(db, t, season2))) throw new HttpsError('failed-precondition', `${t === from ? 'The proposing team' : 'The accepting team'} must prepay $50 of its ${season2} dues before trading a ${season2} pick (rule 8-3-5).`);
  const after = {};
  for (const [t, out, inn, drops] of [[from, T.give.players, T.get.players, T.dropsFrom || []], [to, T.get.players, T.give.players, T.dropsTo || []]]) {
    for (const d of drops) if (!own(t).includes(d) || out.includes(d)) throw new HttpsError('failed-precondition', `${nm(d)} can't be dropped in this trade.`);
    const ir = (R.ir || {})[t] || [], taxi = (R.taxi || {})[t] || [];
    const list = own(t).filter(x => !out.includes(x) && !drops.includes(x)).concat(inn);
    const active = list.filter(x => !ir.includes(x) && !taxi.includes(x));
    const label = t === from ? 'The proposing team' : 'The accepting team';
    // A trade may leave a team over 24 active or 2 QBs, like a waiver claim: it goes through, and that team's lineup is
    // frozen until it's back within the limits (8-1-1, 8-1-4). Drops named with the trade happen with it.
    after[t] = list;
  }
  return after;
}
const cleanAssets = a => ({ players: [...new Set(((a || {}).players || []).map(String))].slice(0, 30),
  picks: ((a || {}).picks || []).slice(0, 20).map(p => ({ season: Number(p.season), round: Number(p.round), roster_id: Number(p.roster_id) })) });

async function tradesAct(db, uid, commish, myTeam, data) {
  const [P, state] = await Promise.all([playerInfo(), getJSON('https://api.sleeper.app/v1/state/nfl')]);
  const me = String(myTeam);
  const [rs, ps] = await Promise.all([db.doc('league/rosters').get(), db.doc('league/picks').get()]);
  const R = rs.data(); if (!R) throw new HttpsError('failed-precondition', 'There are no league rosters yet.');
  const picks = (ps.data() || {}).traded || [];
  const cal = await leagueCalendar(db, state), unpaid = await unpaidTeams(db, cal);
  const gate = async (teams, actor) => {
    for (const t of teams.map(String)) if (unpaid.has(t)) throw new HttpsError('failed-precondition', t === String(actor) ? unpaidMsg(cal.season) : `The other team's ${cal.season} dues aren't paid yet, so it can't trade (rule 6-1-3).`);
    const ir = (await rosterProblems(R, String(actor), P)).filter(x => x.kind === 'ir');
    if (ir.length) throw new HttpsError('failed-precondition', `First: ${ir.map(x => x.msg).join('; ')} (rule 8-1-3).`);
  };
  if (data.action === 'propose' || data.action === 'counter') {
    let from = String(parseInt(data.from ?? myTeam, 10)), to = String(parseInt(data.to, 10)), prev = null;
    if (data.action === 'counter') {
      prev = db.doc(`trades/${String(data.id || '').replace(/[^A-Za-z0-9]/g, '')}`);
      const t0 = (await prev.get()).data(); if (!t0 || t0.status !== 'offered' || (String(t0.to) !== me && !commish)) throw new HttpsError('failed-precondition', 'You can only counter an open offer made to you.');
      from = String(t0.to); to = String(t0.from);
    }
    if (!commish && from !== me) throw new HttpsError('permission-denied', 'You can only offer trades from your own team.');
    if (from === to || !R.rosters[to]) throw new HttpsError('invalid-argument', 'Pick another team to trade with.');
    await gate([from, to], from);
    const T = { from: Number(from), to: Number(to), give: cleanAssets(data.give), get: cleanAssets(data.get), dropsFrom: [...new Set((data.drops || []).map(String))].slice(0, 10), dropsTo: [] };
    if (!T.give.players.length && !T.give.picks.length && !T.get.players.length && !T.get.picks.length) throw new HttpsError('invalid-argument', 'Add at least one player or pick.');
    if (!T.give.players.length && !T.give.picks.length || !T.get.players.length && !T.get.picks.length) throw new HttpsError('invalid-argument', 'Each side has to send something.');
    await checkTrade(db, { ...T, dropsTo: [] }, R, picks, P, state, { prepay: false, lenient: true }).catch(e => { if (!/active players/.test(e.message) || !/accepting/.test(e.message)) throw e; });
    const ref = db.collection('trades').doc();
    await ref.set({ ...T, status: 'offered', at: Date.now(), by: uid, note: String(data.note || '').slice(0, 300), season: String(state.season), counterOf: prev ? prev.id : null });
    if (prev) await prev.update({ status: 'countered', done: Date.now(), counter: ref.id });
    return { ok: true, id: ref.id };
  }
  const ref = db.doc(`trades/${String(data.id || '').replace(/[^A-Za-z0-9]/g, '')}`), T = (await ref.get()).data();
  if (!T) throw new HttpsError('not-found', 'No such trade.');
  const isFrom = String(T.from) === me, isTo = String(T.to) === me;
  if (data.action === 'cancel') { if (!(isFrom || commish) || T.status !== 'offered') throw new HttpsError('failed-precondition', 'Only an open offer can be withdrawn, by the team that made it.'); await ref.update({ status: 'cancelled', done: Date.now() }); return { ok: true }; }
  if (data.action === 'reject') { if (!(isTo || commish) || T.status !== 'offered') throw new HttpsError('failed-precondition', 'Only an open offer made to you can be rejected.'); await ref.update({ status: 'rejected', done: Date.now() }); return { ok: true }; }
  if (data.action === 'veto') { if (!commish || T.status !== 'review') throw new HttpsError('failed-precondition', 'Only a trade in review can be vetoed, by the commissioner (rule 8-3-4).'); await ref.update({ status: 'vetoed', done: Date.now(), note: String(data.reason || 'Vetoed by the commissioner (rule 8-3-4).').slice(0, 300) }); return { ok: true }; }
  if (data.action === 'accept') {
    if (!(isTo || commish) || T.status !== 'offered') throw new HttpsError('failed-precondition', 'Only an open offer made to you can be accepted.');
    const dl = await deadlinePassed(db);
    if (dl.passed) throw new HttpsError('failed-precondition', `The trade deadline has passed (rule 8-3-3: the last game of Week ${TRADE_DEADLINE_WEEK}); trading reopens when the championship game is final.`);
    await gate([T.from, T.to], T.to);
    const T2 = { ...T, dropsTo: [...new Set((data.drops || []).map(String))].slice(0, 10) };
    await checkTrade(db, T2, R, picks, P, state, { prepay: true });
    // Two days of review (8-3-2), then it goes through in the next Wednesday 3 AM batch, never in the middle of a week.
    const reviewUntil = Date.now() + TRADE_REVIEW_MS, processAt = nextBatch(reviewUntil);
    await ref.update({ status: 'review', dropsTo: T2.dropsTo, acceptedAt: Date.now(), reviewUntil, processAt });
    return { ok: true, reviewUntil, processAt };
  }
  throw new HttpsError('invalid-argument', 'Unknown action.');
}
/* settings: the commissioner changes League scoring from the Account page. A change starts at a week that hasn't kicked
   off yet (never an earlier one), so no played game is ever rescored. A change that starts in the current season needs a
   unanimous vote of all 12 Owners; one that starts next season, a Supermajority (rule 13-1-2). Each change is kept, with
   who made it, when, and the vote, as the dated record rule 13-2-3 asks for (shown on the Rules page). */
exports.settings = onCall({ region: 'us-central1', maxInstances: 2, timeoutSeconds: 30 }, async req => {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const db = getFirestore();
  const roles = (await db.doc('config/roles').get()).data() || {};
  if (!(roles.commish || []).includes(uid)) throw new HttpsError('permission-denied', 'Only the commissioner can change League settings.');
  const d = req.data || {};
  if (d.action !== 'scoring') throw new HttpsError('invalid-argument', 'Unknown settings change.');
  const state = await getJSON('https://api.sleeper.app/v1/state/nfl'), cur = Number(state.season);
  const sb = await getJSON(`${ESPN_NFL}/scoreboard`), espnWeek = Number((sb.week || {}).number || state.week);
  const started = (sb.events || []).some(e => e.status.type.state !== 'pre');
  const earliest = { season: cur, week: started ? espnWeek + 1 : espnWeek };
  const season = Number(d.season), week = Number(d.week);
  if (!Number.isInteger(season) || !Number.isInteger(week) || week < 1 || week > 18) throw new HttpsError('invalid-argument', 'Pick the week the change starts.');
  if (wk(season, week) < wk(earliest.season, earliest.week)) throw new HttpsError('failed-precondition', `A change can't start before Week ${earliest.week} of ${earliest.season}: that's the first week no game has kicked off yet.`);
  if (season > cur + 1) throw new HttpsError('invalid-argument', 'Changes can be set for this season or next season.');
  const midseason = season === cur && week > 1;
  if (!d.vote) throw new HttpsError('failed-precondition', midseason ? 'A midseason scoring change needs a unanimous vote of all 12 Owners. Confirm the vote first.' : 'A scoring change needs a Supermajority vote of the Owners (rule 13-1-2). Confirm the vote first.');
  const S = await scoringVersions(), before = scoringAt(S, season, week);
  const settings = {};
  for (const [k, v] of Object.entries(d.settings || {})) {
    if (!(k in S.base)) continue;                    // only stats the League's scoring file lists (the nightly stats keep exactly those)
    const n = Number(v); if (!Number.isFinite(n) || Math.abs(n) > 100) throw new HttpsError('invalid-argument', `${k}: points must be a number between -100 and 100.`);
    if (n !== 0) settings[k] = Math.round(n * 1000) / 1000;
  }
  const changes = [...new Set([...Object.keys(before), ...Object.keys(settings)])].filter(k => (before[k] || 0) !== (settings[k] || 0))
    .map(k => ({ k, from: before[k] || 0, to: settings[k] || 0 }));
  if (!changes.length) throw new HttpsError('failed-precondition', 'Nothing changed.');
  const entry = { season, week, settings, changes, at: Date.now(), by: uid, vote: String(d.vote).slice(0, 200), note: String(d.note || '').slice(0, 300), midseason };
  const keep = S.versions.filter(v => wk(v.season, v.week) !== wk(season, week));        // a second change for the same week replaces the first
  await db.doc('config/scoring').set({ versions: [...keep, entry] , log: FieldValue.arrayUnion({ ...entry, settings: null }) }, { merge: true });
  return { ok: true, season, week, changes: changes.length };
});

/* season: the commissioner's season tools (Account page, js/season-tools.js).
   archive  — once the Blitz Bowl is official: saves the season to the record book (history/{season}, public, the same
              shape as data/history.json; the page builds the entry from the season it shows), the rookie draft order
              (rule 8-2-3) for next year, and opens next year's dues (config/season). A final backup is taken first.
   taxi     — players on a taxi squad past the 2-year limit (8-1-2); with notify, a private message to each GM involved.
   founding — the one-time reset from the 2026 test season to the real league: backup first, then the test rosters,
              lineups, results, moves, trades, claims, waivers, FAAB, traded picks and bracket are cleared. Accounts,
              the commissioner list, the ledger, messages, scoring and drafts stay. Owner only, typed confirmation. */
exports.season = onCall({ region: 'us-central1', maxInstances: 2, timeoutSeconds: 300, memory: '1GiB' }, async req => {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const db = getFirestore(), roles = (await db.doc('config/roles').get()).data() || {};
  if (!(roles.commish || []).includes(uid)) throw new HttpsError('permission-denied', 'Only the commissioner can use the season tools.');
  const d = req.data || {};
  if (d.action === 'archive') {
    const br = (await db.doc('league/bracket').get()).data() || {}, season = String(br.season || '');
    const fin = (br.rounds || []).find(r => /Blitz Bowl/.test(r.name || ''));
    if (!br.champion || !fin || !(fin.games || []).every(g => g.final)) throw new HttpsError('failed-precondition', 'The Blitz Bowl is not official yet.');
    const e = d.entry || {};
    if (String(e.season) !== season || Number(e.champion) !== Number(br.champion)) throw new HttpsError('failed-precondition', 'That summary does not match the final bracket. Reload the page and try again.');
    await saveBackup(db);
    const order = (d.draftOrder || []).map(Number).filter(Number.isInteger);
    await db.doc(`history/${season}`).set({ ...e, draftOrder: order, archivedAt: Date.now(), by: uid });
    await db.doc('config/season').set({ archived: season, duesSeason: Number(season) + 1, draftSeason: Number(season) + 1, draftOrder: order, updated: Date.now() }, { merge: true });
    return { ok: true, season };
  }
  if (d.action === 'taxi') {
    const R = (await db.doc('league/rosters').get()).data() || {}, P = await playerInfo();
    const over = [];
    for (const [t, ids] of Object.entries(R.taxi || {})) for (const id of ids || []) if (P[id] && Number(P[id].exp) >= 2) over.push({ team: Number(t), player: id, name: P[id].name, exp: P[id].exp });
    if (d.notify && over.length) {
      const users = (await db.collection('users').get()).docs;
      for (const t of new Set(over.map(o => o.team))) {
        const names = over.filter(o => o.team === t).map(o => o.name).join(', ');
        for (const u of users.filter(u => Number(u.data().team) === t))
          await db.collection('notes').add({ to: u.id, team: t, by: uid, at: FieldValue.serverTimestamp(), title: 'Taxi squad: time to promote',
            body: `${names} ${names.includes(',') ? 'are' : 'is'} past the 2-year taxi limit (rule 8-1-2). Move them to your active roster or release them before the taxi deadline.` });
      }
    }
    return { over, notified: !!d.notify };
  }
  if (d.action === 'founding') {
    if (roles.owner !== uid) throw new HttpsError('permission-denied', 'Only the League owner can run the founding reset.');
    if (d.confirm !== 'RESET 2026') throw new HttpsError('failed-precondition', 'Type RESET 2026 to confirm.');
    await saveBackup(db);
    for (const c of ['results', 'lineups', 'transactions', 'trades', 'claims']) await db.recursiveDelete(db.collection(c));
    for (const k of ['rosters', 'lineups', 'waivers', 'faab', 'picks', 'bracket']) await db.doc(`league/${k}`).delete();
    await db.doc('config/season').set({ founding: Date.now(), by: uid }, { merge: true });
    return { ok: true };
  }
  throw new HttpsError('invalid-argument', 'Unknown season action.');
});

exports.trades = onCall({ region: 'us-central1', maxInstances: 10, timeoutSeconds: 30, memory: '512MiB' }, async req => {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const db = getFirestore();
  const [roles, user] = await Promise.all([db.doc('config/roles').get(), db.doc(`users/${uid}`).get()]);
  const commish = ((roles.data() || {}).commish || []).includes(uid), team = (user.data() || {}).team;
  if (team == null && !commish) throw new HttpsError('permission-denied', "Your account isn't linked to a team yet.");
  return tradesAct(db, uid, commish, team == null ? null : team, req.data || {});
});

// Process every accepted trade whose two-day review is over: check it again, then swap players and picks, drop the named
// players to waivers, clear moved players from the old team's lineup and log it (transactions, type "trade").
async function processTrades(db) {
  const due = (await db.collection('trades').where('status', '==', 'review').get()).docs.filter(d => (d.data().processAt || d.data().reviewUntil) <= Date.now() + BATCH_SLACK);
  if (!due.length) return { processed: 0 };
  const [P, state, G] = await Promise.all([playerInfo(), getJSON('https://api.sleeper.app/v1/state/nfl'), weekGames()]);
  const cal = await leagueCalendar(db, state), { pickSeasons } = cal, unpaid = await unpaidTeams(db, cal);
  let processed = 0;
  for (const d of due) {
    await db.runTransaction(async tx => {
      const rRef = db.doc('league/rosters'), pRef = db.doc('league/picks'), lRef = db.doc('league/lineups'), wRef = db.doc('league/waivers');
      const [ts, rs, ps, ls, ws] = await Promise.all([tx.get(d.ref), tx.get(rRef), tx.get(pRef), tx.get(lRef), tx.get(wRef)]);
      const T = ts.data(); if (!T || T.status !== 'review') return;
      const R = rs.data(), PK = ps.data() || { traded: [] }, LU = ls.data() || { teams: {} }, W = ws.data() || { players: {} };
      let after;
      const owing = [T.from, T.to].map(String).filter(t => unpaid.has(t));
      if (owing.length) { tx.update(d.ref, { status: 'failed', note: `${cal.season} dues unpaid (rule 6-1-3).`, done: Date.now() }); return; }
      try { after = await checkTrade(db, T, R, PK.traded, P, state, { prepay: false, pickSeasons }); }
      catch (e) { tx.update(d.ref, { status: 'failed', note: e.message, done: Date.now() }); return; }
      const from = String(T.from), to = String(T.to);
      R.rosters[from] = after[from]; R.rosters[to] = after[to];
      for (const t of [from, to]) for (const k of ['ir', 'taxi']) if (R[k] && R[k][t]) R[k][t] = R[k][t].filter(x => after[t].includes(x));
      const gone = { [from]: T.give.players.concat(T.dropsFrom || []), [to]: T.get.players.concat(T.dropsTo || []) };
      for (const t of [from, to]) if (LU.teams && LU.teams[t]) LU.teams[t] = LU.teams[t].map(x => (gone[t].includes(x) ? null : x));
      W.players = W.players || {};
      for (const [t, drops] of [[from, T.dropsFrom || []], [to, T.dropsTo || []]]) for (const x of drops) W.players[x] = { until: waiverClears(Date.now()), from: Number(t) };
      const moved = [];
      for (const [pk, newOwner, oldOwner] of [...T.give.picks.map(p => [p, T.to, T.from]), ...T.get.picks.map(p => [p, T.from, T.to])]) {
        PK.traded = (PK.traded || []).filter(x => pickKey(x) !== pickKey(pk));
        if (newOwner !== pk.roster_id) PK.traded.push({ season: String(pk.season), round: pk.round, roster_id: pk.roster_id, owner_id: newOwner, previous_owner_id: oldOwner });
        moved.push({ season: String(pk.season), round: pk.round, roster_id: pk.roster_id, owner_id: newOwner, previous_owner_id: oldOwner });
      }
      const adds = {}, drops = {};
      for (const x of T.give.players) { adds[x] = T.to; drops[x] = T.from; }
      for (const x of T.get.players) { adds[x] = T.from; drops[x] = T.to; }
      for (const x of T.dropsFrom || []) drops[x] = T.from;
      for (const x of T.dropsTo || []) drops[x] = T.to;
      tx.set(rRef, R); tx.set(pRef, PK); tx.set(lRef, LU); tx.set(wRef, W);
      tx.set(db.collection('transactions').doc(), { type: 'trade', status: 'complete', leg: G.week, created: Date.now(), roster_ids: [T.from, T.to], adds, drops, draft_picks: moved, settings: {}, trade: d.id });
      tx.update(d.ref, { status: 'processed', done: Date.now() });
      processed++;
    });
  }
  return { processed };
}
// movesRun: the weekly moves batch, Wednesday 3 AM Central. Trades whose review is over go through first, then every
// waiver claim on a player whose waiver time is up (a player nobody wins becomes a free agent). Players never change
// teams in the middle of a week this way; free agents can still be added any time (8-4).
exports.movesRun = onSchedule({ schedule: '0 3 * * 3', timeZone: 'America/Chicago', region: 'us-central1', retryCount: 2, timeoutSeconds: 300, memory: '512MiB', maxInstances: 1 }, async () => {
  const db = getFirestore();
  await processTrades(db);
  await settleWaivers(db);
});

// Tests only (never set in production): the pure helpers, for checking the bracket and the Tuesday cutoff.


/* ---------- League backup and workbook ----------
   Everything the League has, in two forms, every night at 2:30 AM Central (leagueBackup), into private Cloud Storage:
     backups/<YYYY-MM-DD>/blitz-league.json   every collection and the site's league files, raw (enough to rebuild from)
     backups/<YYYY-MM-DD>/blitz-league.xlsx   the same as an Excel workbook, one sheet per subject
   plus backups/latest/..., and once a season's Blitz Bowl is official, backups/season-<year>-final/ (kept as that
   season's record book). The commissioner downloads them from the Account page (callable "backup": now, list, get).
   Nothing here goes to the public site repository: the ledger, members, blind claims and private notes are in it.
   The database itself also has Firestore's own daily backups (kept 14 weeks). */
const ExcelJS = require('exceljs');
const BACKUP_COLLECTIONS = ['league', 'results', 'lineups', 'transactions', 'trades', 'claims', 'drafts', 'ledger', 'users', 'devices', 'notes', 'announcements', 'config'];

async function collectLeague(db) {
  const out = { exportedAt: new Date().toISOString(), state: await getJSON('https://api.sleeper.app/v1/state/nfl').catch(() => null), collections: {}, files: {} };
  for (const c of BACKUP_COLLECTIONS) {
    const s = await db.collection(c).get(), docs = {};
    for (const d of s.docs) {
      const v = d.data();
      for (const [k, x] of Object.entries(v)) if (x && typeof x.toDate === 'function') v[k] = x.toDate().toISOString();   // timestamps as text
      docs[d.id] = v;
      if (c === 'drafts') {                                                    // a draft's queues (pools are rebuilt from players.json)
        const q = await d.ref.collection('queues').get();
        if (!q.empty) v._queues = Object.fromEntries(q.docs.map(x => [x.id, x.data()]));
      }
    }
    out.collections[c] = docs;
  }
  const t = Date.now();
  for (const f of ['franchises', 'league', 'history', 'schedule', 'scoring', 'players']) out.files[f] = await getJSON(`${SITE}/data/${f}.json?t=${t}`).catch(() => null);
  out.files.sampleMatchups = await getJSON(`${SITE}/data/sample/matchups.json?t=${t}`).catch(() => null);
  return out;
}

async function buildWorkbook(L) {
  const C = L.collections, F = L.files, fr = (F.franchises || {}).franchises || {}, P = F.players || {};
  const team = id => (id == null || id === '' ? '' : fr[String(id)] ? `${fr[String(id)].location}${fr[String(id)].nickname ? ' ' + fr[String(id)].nickname : ''}` : `Team ${id}`);
  const pl = id => (id && P[id] ? P[id].full_name : id || '');
  const pos = id => (id && P[id] ? ((P[id].fantasy_positions || []).find(x => ['DL', 'LB', 'DB'].includes(x)) || P[id].position || '') : '');
  const nfl = id => (id && P[id] ? P[id].team || 'FA' : '');
  const when = ms => (ms ? new Date(typeof ms === 'number' ? ms : Date.parse(ms)) : '');
  const R = C.league.rosters || {}, LU = C.league.lineups || {}, W = (C.league.waivers || {}).players || {}, FAAB = C.league.faab || {}, PK = (C.league.picks || {}).traded || [], BR = C.league.bracket;
  const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'SUPER_FLEX', 'K', 'DL', 'LB', 'DB', 'IDP_FLEX'];
  const wb = new ExcelJS.Workbook(); wb.creator = 'Blitz Hub'; wb.created = new Date();
  const sheet = (name, cols, rows) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = cols.map(([header, key, width, fmt]) => ({ header, key, width: width || 14, style: fmt ? { numFmt: fmt } : {} }));
    ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7F1FB' } };
    for (const r of rows) ws.addRow(r);
    if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    return ws;
  };
  const DT = 'yyyy-mm-dd hh:mm';
  // About
  sheet('About', [['Item', 'k', 30], ['Value', 'v', 70]], [
    { k: 'League', v: ((F.league || {}).name) || 'The Blitz League' }, { k: 'Exported', v: L.exportedAt },
    { k: 'Official rosters from draft', v: R.name ? `${R.name} (${R.source})` : 'none yet' }, { k: 'Hub scoring starts', v: R.startWeek ? `Week ${R.startWeek}` : '' },
    { k: 'Contents', v: 'Franchises, Members, Rosters, Lineups, Results, Standings, Schedule, Playoffs, Drafts, Draft picks, Transactions, Trades, Waiver claims, FAAB, Pick ownership, Season history, Ledger, Announcements, Notes, Scoring, Players' },
    { k: 'Note', v: 'Built from the live database every night. The matching blitz-league.json holds the same data raw.' }]);
  // Franchises and members
  const users = C.users || {}, roles = C.config.roles || {};
  sheet('Franchises', [['Team id', 'id', 9], ['Location', 'loc', 16], ['Nickname', 'nick', 18], ['Abbr', 'abbr', 7], ['Division', 'div', 12], ['GM', 'gm', 20], ['Linked account', 'acct', 26], ['Founded', 'founded', 9]],
    Object.entries(fr).map(([id, f]) => ({ id: +id, loc: f.location, nick: f.nickname || '', abbr: f.abbr || '', div: f.division, gm: ((((C.config || {}).gms || {}).teams || {})[id] || {}).name || (f.gm || {}).name || '', founded: f.founded || '',
      acct: Object.values(users).filter(u => +u.team === +id).map(u => u.name || u.email || '').join(', ') })));
  sheet('Members', [['Account', 'uid', 30], ['Name', 'name', 20], ['Email', 'email', 28], ['Team', 'team', 22], ['Role', 'role', 16], ['Joined', 'at', 18, DT]],
    Object.entries(users).map(([uid, u]) => ({ uid, name: u.name || '', email: u.email || '', team: team(u.team), role: roles.owner === uid ? 'Owner' : (roles.commish || []).includes(uid) ? 'Commissioner' : 'GM', at: when(u.at) })));
  // Rosters: who's where
  const rosterRows = [];
  for (const [t, ids] of Object.entries(R.rosters || {})) {
    const lu = (LU.teams || {})[t] || [], ir = (R.ir || {})[t] || [], taxi = (R.taxi || {})[t] || [];
    for (const id of ids) { const i = lu.indexOf(id);
      rosterRows.push({ team: team(t), player: pl(id), pos: pos(id), nfl: nfl(id), age: P[id] ? P[id].age || '' : '', status: ir.includes(id) ? 'IR' : taxi.includes(id) ? 'Taxi' : i >= 0 ? `Starter (${SLOTS[i]})` : 'Bench', injury: P[id] ? P[id].injury_status || '' : '', id }); }
  }
  sheet('Rosters', [['Team', 'team', 22], ['Player', 'player', 24], ['Pos', 'pos', 6], ['NFL', 'nfl', 6], ['Age', 'age', 6], ['Status', 'status', 18], ['Injury', 'injury', 12], ['Player id', 'id', 10]], rosterRows);
  // Lineups by week, with points where scored
  const res = Object.values(C.results || {}).sort((a, b) => a.week - b.week);
  const luRows = [];
  for (const [k, doc] of Object.entries(C.lineups || {})) {
    const [season, wk] = k.split('-w'), rr = res.find(r => String(r.season) === season && +r.week === +wk);
    for (const [t, slots] of Object.entries(doc.teams || {})) (slots || []).forEach((id, i) => {
      const x = rr && rr.teams && rr.teams[t]; luRows.push({ season, week: +wk, team: team(t), slot: SLOTS[i] || '', player: pl(id) || '(empty)', pos: pos(id), nfl: nfl(id), pts: x && x.starters && x.starters[i] === id ? x.points[i] : '' }); });
  }
  for (const [t, slots] of Object.entries(LU.teams || {})) (slots || []).forEach((id, i) => luRows.push({ season: 'current', week: 'standing', team: team(t), slot: SLOTS[i] || '', player: pl(id) || '(empty)', pos: pos(id), nfl: nfl(id), pts: '' }));
  sheet('Lineups', [['Season', 'season', 8], ['Week', 'week', 8], ['Team', 'team', 22], ['Slot', 'slot', 11], ['Player', 'player', 24], ['Pos', 'pos', 6], ['NFL', 'nfl', 6], ['Points', 'pts', 8, '0.00']], luRows);
  // Results: Hub weeks plus the placeholder weeks that came before them
  const resultRows = [];
  const sm = F.sampleMatchups || {}, start = R.startWeek || 99;
  for (const [w, rows] of Object.entries(sm)) if (+w < start) for (const m of rows) {
    if (!m.points) continue; const o = rows.find(x => x.matchup_id === m.matchup_id && x.roster_id !== m.roster_id); if (!o) continue;
    resultRows.push({ season: '2026', week: +w, kind: 'placeholder', team: team(m.roster_id), opp: team(o.roster_id), pts: m.points, opppts: o.points, result: m.points > o.points ? 'W' : m.points < o.points ? 'L' : 'T', status: 'placeholder league' });
  }
  for (const r of res) for (const [t, x] of Object.entries(r.teams || {})) { const o = (r.teams || {})[String(x.opp)] || {};
    resultRows.push({ season: r.season, week: r.week, kind: r.kind || 'regular', team: team(t), opp: team(x.opp), pts: x.pts, opppts: o.pts ?? '', result: o.pts == null ? '' : x.pts > o.pts ? 'W' : x.pts < o.pts ? 'L' : 'T', status: r.official ? 'official' : r.final ? 'final' : 'in progress' }); }
  sheet('Results', [['Season', 'season', 8], ['Week', 'week', 7], ['Kind', 'kind', 12], ['Team', 'team', 22], ['Opponent', 'opp', 22], ['Points', 'pts', 9, '0.00'], ['Opp points', 'opppts', 10, '0.00'], ['W/L', 'result', 5], ['Status', 'status', 18]], resultRows);
  // Standings, from the same rule the bracket uses
  const results = {}; for (const r of res) results[r.week] = r;
  const st = standingsFrom(String((L.state || {}).season || '2026'), { schedule: F.schedule || {}, sample: sm }, results, start, Number((L.state || {}).week || 99));
  sheet('Standings', [['Rank', 'rank', 6], ['Team', 'team', 22], ['Division', 'div', 12], ['W', 'w', 5], ['L', 'l', 5], ['T', 't', 5], ['PF', 'pf', 10, '0.00'], ['PA', 'pa', 10, '0.00'], ['Games', 'gp', 7]],
    st.map((s, i) => ({ rank: i + 1, team: team(s.team), div: (fr[String(s.team)] || {}).division || '', w: s.w, l: s.l, t: s.t, pf: s.pf, pa: s.pa, gp: s.gp })));
  // Schedule
  const schedRows = [];
  for (const [season, S] of Object.entries(F.schedule || {})) if (S && S.weeks) for (const [w, games] of Object.entries(S.weeks)) for (const [a, b] of games)
    schedRows.push({ season, status: S.status, week: +w, a: team(a), b: team(b), div: (fr[String(a)] || {}).division === (fr[String(b)] || {}).division ? 'yes' : '' });
  sheet('Schedule', [['Season', 'season', 8], ['Status', 'status', 11], ['Week', 'week', 7], ['Team', 'a', 22], ['Opponent', 'b', 22], ['Division game', 'div', 13]], schedRows);
  // Playoffs
  const poRows = [];
  if (BR) { for (const s of BR.seeds || []) poRows.push({ round: 'Seed', week: '', game: s.how || '', seed: s.seed, team: team(s.team), pts: '', winner: `${s.w}-${s.l}${s.t ? '-' + s.t : ''}, ${s.pf} PF` });
    for (const rd of BR.rounds || []) for (const g of rd.games || []) for (const [t, sd, p] of [[g.a, g.aSeed, g.aPts], [g.b, g.bSeed, g.bPts]]) poRows.push({ round: rd.name, week: rd.week, game: g.label, seed: sd || '', team: team(t) || 'To be decided', pts: p ?? '', winner: g.winner ? (g.winner === t ? 'Won' : 'Lost') : '' }); }
  sheet('Playoffs', [['Round', 'round', 16], ['Week', 'week', 7], ['Game', 'game', 18], ['Seed', 'seed', 6], ['Team', 'team', 22], ['Points', 'pts', 9, '0.00'], ['Result', 'winner', 22]], poRows);
  // Drafts and every pick
  const drafts = Object.entries(C.drafts || {});
  sheet('Drafts', [['Draft id', 'id', 24], ['Name', 'name', 26], ['Kind', 'kind', 9], ['Mode', 'mode', 9], ['Status', 'status', 9], ['Official', 'official', 9], ['Rounds', 'rounds', 7], ['Picks made', 'picks', 10], ['Created', 'created', 18, DT], ['Order', 'order', 60]],
    drafts.map(([id, d]) => ({ id, name: d.name, kind: d.kind, mode: d.mode || (d.practice ? 'mock' : 'official'), status: d.status, official: d.official ? 'yes' : '', rounds: d.rounds, picks: (d.picks || []).length, created: when(d.created), order: (d.teams || []).map(team).join(', ') })));
  const pickRows = [];
  for (const [id, d] of drafts) (d.picks || []).forEach((p, n) => { const T = (d.teams || []).length || 12;
    pickRows.push({ draft: d.name, id, overall: n + 1, round: Math.floor(n / T) + 1, pick: n % T + 1, team: team(p.t), player: pl(p.p), pos: pos(p.p), nfl: nfl(p.p), by: p.by || '', at: when(p.at) }); });
  sheet('Draft picks', [['Draft', 'draft', 26], ['Draft id', 'id', 24], ['Overall', 'overall', 8], ['Round', 'round', 7], ['Pick', 'pick', 6], ['Team', 'team', 22], ['Player', 'player', 24], ['Pos', 'pos', 6], ['NFL', 'nfl', 6], ['How', 'by', 10], ['Time', 'at', 18, DT]], pickRows);
  // Transactions, trades, claims, FAAB, picks
  sheet('Transactions', [['Time', 'at', 18, DT], ['Week', 'leg', 7], ['Type', 'type', 11], ['Teams', 'teams', 30], ['Added', 'adds', 40], ['Dropped', 'drops', 40], ['Picks', 'picks', 40], ['Bid', 'bid', 6]],
    Object.values(C.transactions || {}).sort((a, b) => a.created - b.created).map(x => ({ at: when(x.created), leg: x.leg, type: x.type, teams: (x.roster_ids || []).map(team).join(' / '),
      adds: Object.entries(x.adds || {}).map(([p, t]) => `${pl(p)} → ${team(t)}`).join('; '), drops: Object.entries(x.drops || {}).map(([p, t]) => `${pl(p)} (from ${team(t)})`).join('; '),
      picks: (x.draft_picks || []).map(p => `${p.season} R${p.round} (${team(p.roster_id)}) → ${team(p.owner_id)}`).join('; '), bid: (x.settings || {}).waiver_bid ?? '' })));
  const assets = a => [...((a || {}).players || []).map(pl), ...((a || {}).picks || []).map(p => `${p.season} R${p.round} (${team(p.roster_id)})`)].join('; ');
  sheet('Trades', [['Trade id', 'id', 22], ['Status', 'status', 11], ['From', 'from', 22], ['To', 'to', 22], ['From sends', 'give', 40], ['To sends', 'get', 40], ['Drops', 'drops', 30], ['Offered', 'at', 18, DT], ['Review until', 'rev', 18, DT], ['Note', 'note', 40]],
    Object.entries(C.trades || {}).map(([id, t]) => ({ id, status: t.status, from: team(t.from), to: team(t.to), give: assets(t.give), get: assets(t.get), drops: [...(t.dropsFrom || []), ...(t.dropsTo || [])].map(pl).join('; '), at: when(t.at), rev: when(t.reviewUntil), note: t.note || '' })));
  sheet('Waiver claims', [['Team', 'team', 22], ['Player', 'player', 24], ['Bid', 'bid', 6], ['Drop', 'drop', 24], ['Status', 'status', 11], ['Note', 'note', 40], ['Placed', 'at', 18, DT], ['Settles', 'until', 18, DT], ['Settled', 'done', 18, DT]],
    Object.values(C.claims || {}).sort((a, b) => a.at - b.at).map(c => ({ team: team(c.team), player: pl(c.player), bid: c.bid, drop: pl(c.drop), status: c.status, note: c.note || '', at: when(c.at), until: when(c.until), done: when(c.done) })));
  sheet('FAAB', [['Team', 'team', 22], ['Spent', 'spent', 8], ['Left', 'left', 8], ['Season', 'season', 8]],
    Object.keys(fr).map(t => ({ team: team(t), spent: (FAAB.spent || {})[t] || 0, left: 100 - ((FAAB.spent || {})[t] || 0), season: FAAB.season || '' })));
  const onWaivers = Object.entries(W).map(([p, v]) => ({ player: pl(p), from: team(v.from), until: when(v.until) }));
  sheet('On waivers', [['Player', 'player', 24], ['Dropped by', 'from', 22], ['Clears', 'until', 18, DT]], onWaivers);
  sheet('Pick ownership', [['Season', 'season', 8], ['Round', 'round', 7], ['Original team', 'orig', 22], ['Owner', 'owner', 22], ['From', 'prev', 22]],
    PK.map(p => ({ season: p.season, round: p.round, orig: team(p.roster_id), owner: team(p.owner_id), prev: team(p.previous_owner_id) })));
  // History, ledger, announcements, notes
  const H = (F.history || {}).seasons || [];
  sheet('Season history', [['Season', 'season', 8], ['Champion', 'champ', 22], ['Runner-up', 'ru', 22], ['Third', 'third', 22], ['Division winners', 'divs', 40], ['Team', 'team', 22], ['GM', 'gm', 18], ['W', 'w', 5], ['L', 'l', 5], ['PF', 'pf', 10]],
    H.flatMap(s => Object.entries(s.teams || {}).map(([t, e]) => ({ season: s.season, champ: team(s.champion), ru: team(s.runnerUp), third: team(s.third), divs: (s.divisionWinners || []).map(team).join(', '), team: team(t), gm: e.gmName || '', w: e.wins, l: e.losses, pf: e.pf }))));
  const led = Object.entries(C.ledger || {}), voided = new Set(led.filter(([, e]) => e.kind === 'void').map(([, e]) => e.ref));
  sheet('Ledger', [['Time', 'at', 18, DT], ['Season', 'season', 8], ['Kind', 'kind', 9], ['Team', 'team', 22], ['Amount', 'amount', 9, '$#,##0.00'], ['Prize', 'prize', 14], ['Week', 'week', 7], ['Note', 'note', 40], ['Voided', 'void', 8], ['Entry id', 'id', 22]],
    led.sort((a, b) => String(a[1].at).localeCompare(String(b[1].at))).map(([id, e]) => ({ at: when(e.at), season: e.season, kind: e.kind, team: team(e.team), amount: e.amount, prize: e.prize || '', week: e.week ?? '', note: e.note || '', void: voided.has(id) ? 'yes' : '', id })));
  sheet('Announcements', [['Time', 'at', 18, DT], ['Title', 'title', 30], ['Message', 'body', 80]], Object.values(C.announcements || {}).map(a => ({ at: when(a.at), title: a.title, body: a.body })));
  sheet('Notes', [['Time', 'at', 18, DT], ['To team', 'team', 22], ['Title', 'title', 30], ['Message', 'body', 80]], Object.values(C.notes || {}).map(n => ({ at: when(n.at), team: team(n.team), title: n.title, body: n.body })));
  sheet('Scoring', [['Stat', 'k', 24], ['Points', 'v', 9]], Object.entries((F.scoring || {}).settings || {}).filter(([, v]) => v).map(([k, v]) => ({ k, v })));
  const seen = new Set([...Object.values(R.rosters || {}).flat(), ...pickRows.map(() => null)]);
  for (const [, d] of drafts) for (const p of d.picks || []) seen.add(p.p);
  sheet('Players', [['Player id', 'id', 10], ['Name', 'name', 24], ['Pos', 'pos', 6], ['NFL', 'nfl', 6], ['Age', 'age', 6], ['Exp', 'exp', 5], ['College', 'college', 18]],
    [...seen].filter(id => id && P[id]).map(id => ({ id, name: P[id].full_name, pos: pos(id), nfl: nfl(id), age: P[id].age || '', exp: P[id].years_exp ?? '', college: P[id].college || '' })));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function saveBackup(db) {
  const { getStorage } = require('firebase-admin/storage');
  const L = await collectLeague(db), xlsx = await buildWorkbook(L), json = Buffer.from(JSON.stringify(L));
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  const bucket = getStorage().bucket();
  const dirs = [day, 'latest'];
  // Once the Blitz Bowl is official, a permanent "season final" copy is saved once: that season's record book.
  const br = L.collections.league.bracket, fin = br && br.rounds && br.rounds[2] && br.rounds[2].games[0];
  if (br && br.champion && fin && fin.final) {
    const name = `season-${br.season}-final`, [exists] = await bucket.file(`backups/${name}/blitz-league.xlsx`).exists();
    if (!exists) dirs.push(name);
  }
  for (const dir of dirs) {
    await bucket.file(`backups/${dir}/blitz-league.xlsx`).save(xlsx, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await bucket.file(`backups/${dir}/blitz-league.json`).save(json, { contentType: 'application/json' });
  }
  return { day, dirs, xlsxBytes: xlsx.length, jsonBytes: json.length };
}

exports.leagueBackup = onSchedule({ schedule: '30 2 * * *', timeZone: 'America/Chicago', region: 'us-central1', retryCount: 2, timeoutSeconds: 300, memory: '1GiB', maxInstances: 1 }, async () => {
  await saveBackup(getFirestore());
});

// The commissioner's copy: "now" builds a fresh workbook, "list" names the saved nights, "get" returns one of them.
exports.backup = onCall({ region: 'us-central1', maxInstances: 2, timeoutSeconds: 300, memory: '1GiB' }, async req => {
  const uid = req.auth && req.auth.uid; if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const db = getFirestore(), roles = (await db.doc('config/roles').get()).data() || {};
  if (!(roles.commish || []).includes(uid)) throw new HttpsError('permission-denied', 'Only the commissioner can download the league backup.');
  const a = (req.data || {}).action;
  const { getStorage } = require('firebase-admin/storage'), bucket = getStorage().bucket();
  if (a === 'now') {                                    // a fresh copy: saved like the nightly one, then handed over
    const r = await saveBackup(db), [buf] = await bucket.file(`backups/${r.day}/blitz-league.xlsx`).download();
    return { name: `blitz-league-${r.day}.xlsx`, data: buf.toString('base64'), saved: r.day };
  }
  if (a === 'list') { const [files] = await bucket.getFiles({ prefix: 'backups/' }), dirs = [...new Set(files.map(f => f.name.split('/')[1]))];
    return { finals: dirs.filter(d => /^season-\d{4}-final$/.test(d)).sort().reverse(), days: dirs.filter(d => /^\d{4}-\d\d-\d\d$/.test(d)).sort().reverse() }; }
  if (a === 'get') {
    const day = String((req.data || {}).day || ''), kind = (req.data || {}).kind === 'json' ? 'json' : 'xlsx';
    if (!/^(\d{4}-\d\d-\d\d|season-\d{4}-final)$/.test(day)) throw new HttpsError('invalid-argument', 'Pick a saved copy.');
    const [buf] = await bucket.file(`backups/${day}/blitz-league.${kind}`).download();
    return { name: `blitz-league-${day}.${kind}`, data: buf.toString('base64') };
  }
  throw new HttpsError('invalid-argument', 'Unknown action.');
});

// Tests only (never set in production): the pure helpers.
if (process.env.BLITZ_TEST) module.exports._t = { bracketFrom, standingsFrom, seedsFrom, officialAt, chiParts, collectLeague, buildWorkbook, freeze, nextBatch, rosterProblems, unpaidTeams };
