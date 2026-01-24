import { setActiveNav, loadTournament, esc } from "./util.js";
import { getFB, ensureTournamentDocs, watchAuth, signIn, signOutUser } from "./store-fb.js";
import { firebaseReady } from "./firebase.js";

setActiveNav("admin");
const FB = getFB();

const $ = (id)=>document.getElementById(id);

function showState(msg, ok=true){
  $("initState").textContent = msg;
  $("initState").style.color = ok ? "var(--muted)" : "#ff9a9a";
}

(async function(){
  if(!firebaseReady() || !FB){
    showState("Firebase not configured. Fill js/firebase-config.js and reload.", false);
    $("btnInit").disabled = true;
    $("btnLogin").disabled = true;
    return;
  }

  const t = await loadTournament();

  const scorerLinks = $("scorerLinks");

// Render all matches group-wise (A/B/C/D + Knockouts), so scorer can open any fixture.
const order = ["A","B","C","D","KO"];
const labelFor = (g)=> g==="KO" ? "Knockouts" : `Group ${g}`;
const groups = {};
for(const m of (t.matches||[])){
  const g = m.group || "—";
  (groups[g] ||= []).push(m);
}
let html = '';
for(const g of order){
  if(!groups[g] || !groups[g].length) continue;
  html += `<div class="muted small" style="width:100%;margin-top:8px">${esc(labelFor(g))}</div>`;
  html += groups[g].map(m=>{
    const title = m.label ? `${m.matchId} • ${m.label}` : m.matchId;
    return `<a class="pill" title="${esc(title)}" href="scorer.html?match=${encodeURIComponent(m.matchId)}">${esc(m.matchId)}</a>`;
  }).join("");
}
// Any other groups (if added later) also show.
for(const g of Object.keys(groups)){
  if(order.includes(g)) continue;
  html += `<div class="muted small" style="width:100%;margin-top:8px">${esc(labelFor(g))}</div>`;
  html += groups[g].map(m=>`<a class="pill" href="scorer.html?match=${encodeURIComponent(m.matchId)}">${esc(m.matchId)}</a>`).join("");
}
html += `<a class="pill" href="schedule.html">All matches</a>`;
scorerLinks.innerHTML = html;


  watchAuth(FB, (user)=>{
    if(user){
      $("authState").textContent = `Signed in: ${user.email}`;
      $("btnLogin").style.display="none";
      $("btnLogout").style.display="inline-flex";
      $("btnInit").disabled=false;
    } else {
      $("authState").textContent = "Not signed in.";
      $("btnLogin").style.display="inline-flex";
      $("btnLogout").style.display="none";
      $("btnInit").disabled=true;
    }
  });

  $("btnLogin").addEventListener("click", async ()=>{
    try{
      await signIn(FB, $("email").value.trim(), $("pass").value);
    }catch(e){
      $("authState").textContent = "Login failed: " + (e?.message||e);
    }
  });

  $("btnLogout").addEventListener("click", async ()=>{
    await signOutUser(FB);
  });

  $("btnInit").addEventListener("click", async ()=>{
    try{
      showState("Initializing…");
      await ensureTournamentDocs(FB, t);
      showState("Done ✅ Tournament + matches created/updated in Firestore.");
    }catch(e){
      showState("Init failed: " + (e?.message||e), false);
    }
  });
})();
