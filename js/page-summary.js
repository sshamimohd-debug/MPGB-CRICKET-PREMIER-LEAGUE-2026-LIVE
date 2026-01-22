import {setActiveNav, preferredMatchId, persistLastMatchId, wireBottomNav, esc, teamDisp} from "./util.js";
import { getFB, watchMatch } from "./store-fb.js";
import { renderScoreLine, renderBestPerformers, renderMatchDetailsCard, deriveAwardsForUI, formatMomDetailLine, deriveResultText } from "./renderers.js";



// --- UI-only robust awards fallback (does NOT change scoring logic) ---
function safeAwardsFromState(doc){
  const st = doc?.state || {};
  const innings = Array.isArray(st?.innings) ? st.innings : [];
  const stats = new Map(); // name -> {team,r,six,four,w,bowlBalls,bowlRuns}
  const up = (name, team)=>{
    if(!name) return null;
    const k = String(name);
    if(!stats.has(k)) stats.set(k,{name:k, team:team||"", r:0, b:0, four:0, six:0, w:0, bowlBalls:0, bowlRuns:0, econ:null});
    const p = stats.get(k);
    if(team && !p.team) p.team = team;
    return p;
  };
  for(const inn of innings){
    const batTeam = inn?.batting || "";
    const bowlTeam = inn?.bowling || "";
    const batters = inn?.batters || {};
    const bowlers = inn?.bowlers || {};
    for(const [nm,bt] of Object.entries(batters)){
      const p = up(nm, batTeam); if(!p) continue;
      p.r += Number(bt?.r||0);
      p.b += Number(bt?.b||0);
      p.four += Number(bt?.f4 ?? bt?.fours ?? 0);
      p.six  += Number(bt?.f6 ?? bt?.sixes ?? 0);
    }
    for(const [nm,bw] of Object.entries(bowlers)){
      const p = up(nm, bowlTeam); if(!p) continue;
      const balls = Number(bw?.balls ?? bw?.oBalls ?? 0);
      p.bowlBalls += balls;
      p.bowlRuns  += Number(bw?.r||0);
      p.w         += Number(bw?.w ?? bw?.wkts ?? bw?.wickets ?? 0);
    }
  }
  for(const p of stats.values()){
    const overs = p.bowlBalls>0 ? (p.bowlBalls/6) : 0;
    if(overs>0) p.econ = Math.round((p.bowlRuns/overs)*100)/100;
  }
  let mom=null, sixer=null, bowler=null;
  for(const p of stats.values()){
    // simple impact (UI only)
    const score = (p.r||0) + (p.six||0)*2 + (p.four||0) + (p.w||0)*25 + (p.econ!=null ? Math.max(0, 20 - p.econ*2) : 0);
    if(!mom || score>mom.score) mom={name:p.name, team:p.team, score:Math.round(score)};
    if(!sixer || (p.six||0)>(sixer.sixes||0)) sixer={name:p.name, team:p.team, sixes:p.six||0};
    if((p.w||0)>0){
      const cand={name:p.name, team:p.team, wkts:p.w||0, econ:p.econ};
      if(!bowler || cand.wkts>bowler.wkts) bowler=cand;
      else if(cand.wkts===bowler.wkts && (cand.econ??999)<(bowler.econ??999)) bowler=cand;
    }
  }
  const momDetails = mom?.name ? stats.get(String(mom.name)) : null;
  return { mom, sixerKing:sixer, bestBowler:bowler, momDetails };
}

setActiveNav("summary");

const FB = getFB();
const matchId = preferredMatchId("A1");
persistLastMatchId(matchId);
wireBottomNav(matchId);

// Wire nav tabs / buttons
const scorecardUrl = `scorecard.html?match=${encodeURIComponent(matchId)}`;
const commentaryUrl = `live.html?match=${encodeURIComponent(matchId)}`;

document.getElementById("btnScorecard").href = scorecardUrl;
document.getElementById("btnCommentary").href = commentaryUrl;
document.getElementById("tabSummary").href = `summary.html?match=${encodeURIComponent(matchId)}`;
document.getElementById("tabScorecard").href = scorecardUrl;
document.getElementById("tabCommentary").href = commentaryUrl;

if (!FB) {
  document.getElementById("sumTitle").textContent = "Firebase not configured";
  document.getElementById("sumMeta").textContent = "Please set Firebase config in js/firebase-config.js";
} else {
  watchMatch(FB, matchId, (doc) => {
    if (!doc) {
      document.getElementById("sumTitle").textContent = "Match not found";
      document.getElementById("sumMeta").textContent = `Match ${esc(matchId)} not available in database.`;
      return;
    }

    document.getElementById("sumTitle").textContent = `${doc.a} vs ${doc.b}`;
    document.getElementById("sumMeta").textContent = `Match ${doc.matchId} • ${doc.group ? `Group ${doc.group}` : ""}${doc.time ? ` • ${doc.time}` : ""} • Status: ${doc.status}`;

    document.getElementById("scoreLine").innerHTML = renderScoreLine(doc);
    document.getElementById("bestWrap").innerHTML = renderBestPerformers(doc);
    document.getElementById("details").innerHTML = renderMatchDetailsCard(doc);

    // Result (highlight)
    const rText = deriveResultText(doc);
    const sr = document.getElementById("sumResultText");
    if(sr){ sr.textContent = rText || "—"; }

    // Awards + Result helpers (fallback compute from state if awards missing)
    // Awards + Result helpers (fallback compute from state if awards missing)
    let aw = null;
    try{ aw = deriveAwardsForUI(doc); }catch(e){ aw = null; }
    // If compute failed or empty, use robust UI-only fallback
    if(!aw || (!aw.mom && !aw.sixerKing && !aw.bestBowler)){
      aw = safeAwardsFromState(doc);
    }
    const six = aw?.sixerKing;
    const bw = aw?.bestBowler; // used as Most Wickets
    const mom = aw?.mom;
    const momLine = formatMomDetailLine(aw?.momDetails);
    const sixEl = document.getElementById("mostSixes");
    if(sixEl){
      sixEl.innerHTML = six?.name
        ? `<b>${esc(six.name)}</b> <span class="muted small">(${esc(six.team||"")})</span>${six?.sixes!=null?`<div class="muted small" style="margin-top:4px">6s: <b>${esc(six.sixes)}</b></div>`:""}`
        : `<span class="muted small">—</span>`;
    }
    const wkEl = document.getElementById("mostWickets");
    if(wkEl){
      wkEl.innerHTML = bw?.name
        ? `<b>${esc(bw.name)}</b> <span class="muted small">(${esc(bw.team||"")})</span>${bw?.wkts!=null?`<div class="muted small" style="margin-top:4px">Wkts: <b>${esc(bw.wkts)}</b>${bw?.econ!=null?` • Econ: <b>${esc(bw.econ)}</b>`:""}</div>`:""}`
        : `<span class="muted small">—</span>`;
    }

    // Player of match
    document.getElementById("pom").innerHTML = mom?.name
      ? `<b>${esc(mom.name)}</b> <span class="muted small">(${esc(mom.team || "")})</span>${mom?.score!=null?`<div class="muted small" style="margin-top:4px">Score: <b>${esc(mom.score)}</b></div>`:""}${momLine?`<div class="muted small" style="margin-top:4px">${esc(momLine)}</div>`:""}`
      : `<span class="muted small">—</span>`;

        // Notes
    const notes = doc.notes || doc.note || doc.matchNotes || "";
    document.getElementById("notesWrap").innerHTML = notes ? esc(notes) : "—";
  });
}