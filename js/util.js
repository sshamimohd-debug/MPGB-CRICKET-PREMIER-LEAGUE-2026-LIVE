export const $ = (s, el=document)=>el.querySelector(s);
export const $$ = (s, el=document)=>Array.from(el.querySelectorAll(s));
export const esc = (s)=> (s??"").toString().replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function setActiveNav(key){
  document.querySelectorAll('[data-nav]').forEach(a=>{
    if(a.dataset.nav===key) a.classList.add('active'); else a.classList.remove('active');
  });

  // Global UI boot (logo + splash). UI-only: does not touch scoring/Firebase.
  try{ ensureBrandLogo(); }catch(e){}
  try{ showSplashOnce(); }catch(e){}
}

// Tournament logo handling: attach image into .logo block (fallback safe)
export function ensureBrandLogo(){
  const el = document.querySelector('.logo');
  if(!el) return;

  // If CSS already set a background-image, keep it.
  const bg = (getComputedStyle(el).backgroundImage || "").toLowerCase();
  // Many pages use a gradient placeholder. If we detect a gradient, we replace it with the tournament logo.
  if(bg && bg !== "none" && !bg.includes("gradient")) return;

  // Fallback to app icon as tournament logo.
  el.style.backgroundImage = "url('assets/icons/icon-72.png')";
  el.style.backgroundSize = 'cover';
  el.style.backgroundPosition = 'center';
  el.style.backgroundRepeat = 'no-repeat';
}

// Splash popup (once per tab/session)
export function showSplashOnce(){
  // Only show on first load of a browsing session.
  const KEY = 'mpgb_mpl_splash_seen_v1';
  if(sessionStorage.getItem(KEY) === '1') return;
  sessionStorage.setItem(KEY, '1');

  // Avoid double mount
  if(document.getElementById('mplSplash')) return;

  const wrap = document.createElement('div');
  wrap.id = 'mplSplash';
  wrap.className = 'mplSplash';
  wrap.innerHTML = `
    <div class="mplSplashCard" role="dialog" aria-label="MPGB Premier League">
      <div class="mplSplashLogo" aria-hidden="true"></div>
      <div class="mplSplashTitle">MPGB Premier League</div>
      <div class="mplSplashSub">Cricket Tournament 2025-26</div>
      <div class="mplSplashDev">App developed by <b>Mohammad Shamim</b></div>
      <div class="mplSplashHint">Tap anywhere to continue</div>
    </div>
  `;
  document.body.appendChild(wrap);

  // Lock background scroll while splash is visible
  document.body.classList.add('splashLock');

  // Set logo background (uses same icon)
  const logo = wrap.querySelector('.mplSplashLogo');
  if(logo){
    logo.style.backgroundImage = "url('assets/icons/icon-192.png')";
  }

  const close = ()=>{
    wrap.classList.add('hide');
    document.body.classList.remove('splashLock');
    try{ document.removeEventListener('keydown', onKey); }catch(e){}
    setTimeout(()=>{ try{ wrap.remove(); }catch(e){} }, 220);
  };
  wrap.addEventListener('click', close, {once:true});
  const onKey = (e)=>{ if(e.key==='Escape') close(); };
  document.addEventListener('keydown', onKey);

  // NOTE: No auto-close. User must tap/click to continue.
}
export async function loadTournament(){
  const res = await fetch('data/tournament.json', {cache:'no-store'});
  if(!res.ok) throw new Error('Cannot load data/tournament.json');
  const t = await res.json();
  globalThis.__TOUR = t;
  globalThis.__TEAM_META = t.teamMeta || {};
  globalThis.__SQUAD_META = t.squadMeta || {};
  return t;
}

// Display helper: full team name from tournament.teamMeta
export function teamDisp(key){
  const k = (key??"").toString();
  const tm = globalThis.__TEAM_META || {};
  const v = tm[k];
  if(typeof v === "string") return v;
  if(v && typeof v === "object") return v.name || v.teamName || v.title || k;
  return k;
}

export function fmtStatus(s){
  if(s==='LIVE') return {cls:'live', text:'LIVE'};
  if(s==='COMPLETED') return {cls:'done', text:'COMPLETED'};
  return {cls:'up', text:'UPCOMING'};
}
export function qs(){
  return new URLSearchParams(location.search);
}
export function idHash(s){
  return (s||"").toString().trim();
}

// ----------------------------
// Match context helpers (keeps Scorecard/Live tabs in-sync)
// ----------------------------
const LAST_MATCH_KEY = "mpgb_last_match";

export function persistLastMatchId(matchId){
  try{
    const id = (matchId || "").toString().trim();
    if(id) localStorage.setItem(LAST_MATCH_KEY, id);
  }catch(e){}
}

export function getLastMatchId(){
  try{ return (localStorage.getItem(LAST_MATCH_KEY) || "").toString().trim(); }
  catch(e){ return ""; }
}

// Preferred match id resolution order:
// 1) URL ?match=
// 2) persisted last match
// 3) fallback (default: A1)
export function preferredMatchId(fallback="A1"){
  const q = qs().get("match");
  const saved = getLastMatchId();
  return (q || saved || fallback).toString().trim();
}

// Rewrite bottom tab links so they keep the current match context.
// Works on pages that have the bottomNav markup.
export function wireBottomNav(matchId){
  try{
    const id = (matchId || "").toString().trim();
    if(!id) return;
    const map = {
      live: `live.html?match=${encodeURIComponent(id)}`,
      scorecard: `scorecard.html?match=${encodeURIComponent(id)}`
    };
    const apply = ()=>{
      document.querySelectorAll('.bottomNav a[data-nav]')
        .forEach(a=>{
          const k = a.getAttribute('data-nav');
          if(map[k]) a.setAttribute('href', map[k]);
        });
    };

    // Some pages load their module script before rendering bottomNav markup.
    // In that case, defer link rewriting until DOM is ready.
    if(document.querySelector('.bottomNav')) apply();
    else window.addEventListener('DOMContentLoaded', apply, {once:true});
  }catch(e){}
}


// Squad meta helper: returns array of player objects (name, role, isCaptain/isViceCaptain/isWicketKeeper)
export function getSquadMeta(teamKey){
  const k = (teamKey??"").toString();
  const sm = globalThis.__SQUAD_META || {};
  const arr = sm[k];
  return Array.isArray(arr) ? arr : [];
}

export function roleLabel(role){
  const r = (role||"").toString().toUpperCase();
  if(r==="BAT") return "Batsman";
  if(r==="BOWL") return "Bowler";
  if(r==="AR") return "All-Rounder";
  if(r==="WK") return "Wicket Keeper";
  return r || "";
}
