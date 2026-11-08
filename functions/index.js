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
exports.duesReminders = onSchedule({ schedule: '0 10 * * *', timeZone: 'America/Chicago', region: 'us-central1', retryCount: 0 }, async () => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const msg = DUES.dates[today];
  if (!msg) return;
  const db = getFirestore();
  const entries = (await db.collection('ledger').where('season', '==', DUES.season).get()).docs.map(d => ({ id: d.id, ...d.data() }));
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
//   yardage bonuses score exactly). Game clocks and scores: ESPN's scoreboard. Scoring: the League's settings on Sleeper
//   for now (to move into the Hub's own settings when the Hub replaces Sleeper).
// It does nothing between games: it runs when a game is in progress, or once more when one has just gone final.
const ESPN_NFL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const LEAGUE_ID = '1423408541737156608';
const TEAMFIX = { WSH: 'WAS' };
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
  const games = (sb.events || []).map(e => {
    const c = e.competitions[0], side = h => { const t = c.competitors.find(x => x.homeAway === h); const a = t.team.abbreviation; return { abbr: TEAMFIX[a] || a, score: Number(t.score || 0) }; };
    return { id: e.id, at: e.date, state: e.status.type.state, detail: e.status.type.shortDetail, away: side('away'), home: side('home') };
  });
  const db = getFirestore(), ref = db.doc('live/current');
  const prev = (await ref.get()).data() || {};
  const was = Object.fromEntries((prev.states || []).map(x => x.split(':')));
  const changed = games.some(g => was[g.id] !== g.state);
  if (!games.some(g => g.state === 'in') && !changed) return;      // no game on, nothing new since the last run

  const state = await getJSON('https://api.sleeper.app/v1/state/nfl');
  const season = String(state.season), week = Number(state.week);
  const scoring = (await getJSON(`https://api.sleeper.app/v1/league/${LEAGUE_ID}?t=${Date.now()}`)).scoring_settings || {};
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
});
