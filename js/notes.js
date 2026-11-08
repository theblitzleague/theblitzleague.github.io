/* Private messages from the commissioner to one GM (notes/{id} in the database; firestore.rules lets only that GM and
   the commissioner read them). js/ui.js loads this on devices where someone has signed in and asks it for the signed-in
   GM's messages from the last three weeks, to pop up any this device hasn't shown yet. */
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';
import { collection, doc, getDoc, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';
import { auth, db, rememberSignedIn } from './fb.js';

const user = new Promise(res => { const stop = onAuthStateChanged(auth, u => { stop(); rememberSignedIn(!!u); res(u); }); });

export async function mine(days = 21) {
  const u = await user;
  if (!u) return [];
  const snap = await getDocs(query(collection(db, 'notes'), where('to', '==', u.uid)));
  const cut = Date.now() - days * 864e5;
  return snap.docs.map(d => { const n = d.data(); return { id: d.id, title: n.title, body: n.body, at: n.at && n.at.toDate ? n.at.toDate() : new Date(0), private: true }; })
    .filter(n => n.title && +n.at > cut).sort((a, b) => b.at - a.at);
}

// The team the signed-in person runs (the commissioner links it on the Account page), or null.
export async function myTeam() {
  const u = await user;
  if (!u) return null;
  const t = ((await getDoc(doc(db, 'users', u.uid))).data() || {}).team;
  return t == null ? null : +t;
}
