/* Blitz Hub phone notifications.

   announce: when the commissioner posts to announcements/{id} (only the commissioner can, see firestore.rules), send it
   to every registered phone of a GM who is linked to a team, plus the commissioner's own. The message is data-only:
   sw.js on the phone turns it into the notification, so it looks the same everywhere. Phones whose registration has
   expired are removed. The send result (sent / failed) is written back onto the announcement for the Commissioner panel. */
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
const GONE = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'];

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
