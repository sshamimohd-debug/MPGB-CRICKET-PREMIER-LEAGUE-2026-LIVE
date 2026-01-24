import {setActiveNav, preferredMatchId, persistLastMatchId, wireBottomNav, esc, teamDisp, mountLiveFeedToasts} from "./util.js";
import { getFB, watchMatch } from "./store-fb.js";
import { renderScoreLine, renderCommentary, deriveResultText } from "./renderers.js";

setActiveNav("live");
const FB = getFB();
const matchId = preferredMatchId("A1");
persistLastMatchId(matchId);
wireBottomNav(matchId);

// Phase-2: real-time toast feed (leader changes, milestones, over-end)
mountLiveFeedToasts(FB, { seenKey:`liveFeed:lastSeen:${matchId}` });


function ensureResultBanner(){
  const meta = document.getElementById("mMeta");
  if(!meta) return null;
  let el = document.getElementById("liveResultBanner");
  if(!el){
    el = document.createElement("div");
    el.id = "liveResultBanner";
    el.style.marginTop = "8px";
    el.style.padding = "8px 10px";
    el.style.borderRadius = "10px";
    el.style.background = "rgba(0,0,0,0.04)";
    el.style.fontWeight = "700";
    el.style.display = "none";
    meta.insertAdjacentElement("afterend", el);
  }
  return el;
}


const summaryUrl = `summary.html?match=${encodeURIComponent(matchId)}`;
const scorecardUrl = `scorecard.html?match=${encodeURIComponent(matchId)}`;
const commentaryUrl = `live.html?match=${encodeURIComponent(matchId)}`;

document.getElementById("btnSummary").href = summaryUrl;
document.getElementById("btnScorecard").href = scorecardUrl;

// Tabs
document.getElementById("tabSummary").href = summaryUrl;
document.getElementById("tabScorecard").href = scorecardUrl;
document.getElementById("tabCommentary").href = commentaryUrl;

if(!FB){
  document.getElementById("mTitle").textContent = "Firebase not configured";
} else {
  watchMatch(FB, matchId, (doc)=>{
    if(!doc){
      document.getElementById("mTitle").textContent = "Match not found";
      return;
    }
    document.getElementById("mTitle").textContent = `${doc.a} vs ${doc.b}`;
    document.getElementById("mMeta").textContent = `Match ${doc.matchId} • Group ${doc.group} • ${doc.time} • Status: ${doc.status}`;
    document.getElementById("liveTop").innerHTML = renderScoreLine(doc);
    document.getElementById("commentary").innerHTML = renderCommentary(doc);
    // Result banner (show on completed/tied etc.)
    const rb = ensureResultBanner();
    const rText = deriveResultText(doc);
    if(rb && rText){ rb.style.display="block"; rb.textContent = `RESULT: ${rText}`; }
    else if(rb){ rb.style.display="none"; rb.textContent=""; }
  });
}
