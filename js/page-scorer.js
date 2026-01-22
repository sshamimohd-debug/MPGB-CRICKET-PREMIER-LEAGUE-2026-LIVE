import { initScorerWizard } from "./scorer-wizard.js";
import {setActiveNav, qs, loadTournament, teamDisp} from "./util.js";
import { getFB, watchMatch, watchAuth, addBall, undoBall, setMatchStatus, resetMatch, setToss, setPlayingXI, setOpeningSetup, finalizeMatchAndComputeAwards, startSecondInnings } from "./store-fb.js";
import { renderScoreLine, renderCommentary, deriveAwardsForUI, formatMomDetailLine, deriveResultText } from "./renderers.js";

setActiveNav("scorer");
const FB = getFB();
const USE_SETUP_WIZARD = true; // Use full-screen setup wizard; hide legacy setup cards
let WIZARD = null;

const $ = (id)=>document.getElementById(id);
const esc = (s)=> (s??"").toString().replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));

const params = qs();
const matchId = params.get("matchId") || params.get("match") || "A1";

let TOURNAMENT = null;
let SQUADS = {}; // team -> [15]
let CURRENT_DOC = null;
let LAST_STATUS = null;
let _tossMounted = false;
let _xiMounted = false;
let _openingMounted = false;
let _breakMounted = false;

let _wizardBound = false;

// -----------------------------
// Helpers
// -----------------------------

function ensureWizard(){
  if(WIZARD || !document.getElementById("setupWizard")) return;
  WIZARD = initScorerWizard({
    FB,
    matchId,
    getDoc: ()=>CURRENT_DOC,
    getTournament: ()=>TOURNAMENT,
    getSquads: ()=>SQUADS,
    setToss,
    setPlayingXI,
    setOpeningSetup,
    setMatchStatus,
    onDone: ()=>{
      // after wizard done, we keep normal scorer UI as-is
      showState("Setup complete. Ab scoring start kar sakte ho.", true);
    }
  });
}


function showState(msg, ok=true){
  const el = $("sMeta");
  if(!el) return;
  el.textContent = msg;
  el.style.color = ok ? "var(--muted)" : "#ff9a9a";
}

function renderFreeHitBadge(doc){
  const badge = document.getElementById("freeHitBadge");
  if(!badge) return;
  const inn = currentInnings(doc);
  const of = inn?.onField || {};
  badge.style.display = of.freeHit ? "inline-flex" : "none";
}


function _oversTextFromBalls(balls){
  const o = Math.floor((Number(balls||0))/6);
  const b = Math.floor((Number(balls||0))%6);
  return `${o}.${b}`;
}

function _innings2Started(doc){
  const st = doc?.state || {};
  const i1 = st?.innings?.[1];
  return !!(i1 && (Number(i1.balls||0)>0 || (Array.isArray(i1.ballByBall) && i1.ballByBall.length>0)));
}

function maybeShowInningsBreak(doc){
  try{
    const st = doc?.state || {};
    const idx = Number(st.inningsIndex||0);

    const i0 = st?.innings?.[0];
    if(!i0) return;

    // Only show once innings 1 has finished (overs/all out)
    const oversLimit = Number(st.oversPerInnings||10);
    const maxBalls = oversLimit * 6;
    const innings1Done = Number(i0.wkts||0) >= 10 || Number(i0.balls||0) >= maxBalls;
    if(!innings1Done) return;

    // Only show if innings 2 has NOT started yet (no ball logged)
    if(_innings2Started(doc)) return;

    // Scoring core may already flip inningsIndex to 1 automatically at innings end.
    // So allow overlay in both idx=0 and idx=1 transition states.
    if(!(idx === 0 || idx === 1)) return;

    // If modal already open, keep it
    if(document.getElementById("inningsBreakOverlay")) return;

    const i1 = st?.innings?.[1] || {};
    const target = Number(i0.runs||0) + 1;

    // Determine teams for 2nd innings (prefer state.innings[1] bindings)
    const bat2 = (i1?.batting) ? i1.batting : (i0.bowling || doc?.bowlingFirst || doc?.b);
    const bowl2 = (i1?.bowling) ? i1.bowling : (i0.batting || doc?.battingFirst || doc?.a);

    const batXI = st.playingXI?.[bat2] || [];
    const bowlXI = st.playingXI?.[bowl2] || [];

    // Guard: if XI not available, skip (otherwise dropdowns blank)
    if(!batXI.length || !bowlXI.length) return;

    // If opening already set for innings 2, don't show
    const i1of = (st?.innings?.[1]?.onField) || {};
    const openingAlready = !!(i1of.striker && i1of.nonStriker && i1of.bowler);
    if(openingAlready) return;

    
    // --- Innings Break UI-only computed stats (no scoring logic changes) ---
    const runs1 = Number(i0.runs||0);
    const wkts1 = Number(i0.wkts||0);
    const balls1 = Number(i0.balls||0);
    const oversText1 = _oversTextFromBalls(balls1);
    const rr1 = balls1 ? (runs1 * 6 / balls1) : 0;
    const ex = i0.extras || {wd:0, nb:0, b:0, lb:0};
    const exWd = Number(ex.wd||0), exNb = Number(ex.nb||0), exB = Number(ex.b||0), exLb = Number(ex.lb||0);
    const exTotal = exWd + exNb + exB + exLb;

    // Top scorer from innings-1 batting card
    let topB = null;
    try{
      const bats = i0.batters || {};
      Object.keys(bats).forEach(k=>{
        const it = bats[k] || {};
        const r = Number(it.r||0);
        const b = Number(it.b||0);
        if(!topB || r > topB.r || (r===topB.r && b < topB.b)){
          topB = { name: it.name||k, r, b };
        }
      });
    }catch(e){}

    // Best bowler from innings-1 bowlers card (max wickets, then least runs)
    let bestBo = null;
    try{
      const bowls = i0.bowlers || {};
      Object.keys(bowls).forEach(k=>{
        const it = bowls[k] || {};
        const w = Number(it.w||0);
        const r = Number(it.r||0);
        const oBalls = Number(it.oBalls||0);
        if(!bestBo || w > bestBo.w || (w===bestBo.w && r < bestBo.r)){
          bestBo = { name: it.name||k, w, r, oBalls };
        }
      });
    }catch(e){}
const overlay = document.createElement("div");
    overlay.id = "inningsBreakOverlay";
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="popup" style="max-width:720px">
        <div class="row" style="justify-content:space-between; gap:12px; align-items:center">
          <div>
            <div class="h1" style="font-size:18px">Innings Break</div>
            <div class="muted small" style="margin-top:2px">
              <b>1st Innings</b> • ${esc(i0.batting||doc?.a)} ${esc(Number(i0.runs||0))}/${esc(Number(i0.wkts||0))} (${esc(_oversTextFromBalls(i0.balls))}/${esc(oversLimit)} ov)
              <span style="opacity:.7">•</span> <b>Target</b>: ${esc(target)}
            </div>
          </div>
          <span class="badge live">LIVE</span>
        </div>

        <hr class="sep"/>

        <div class="ibProgress">
          <span class="ibDot done"></span><span class="ibTxt">Innings 1 done</span>
          <span class="ibSep">→</span>
          <span class="ibDot"></span><span class="ibTxt">Innings 2 setup</span>
        </div>

        <div class="grid ibStats" style="gap:10px; margin-top:10px">
          <div class="card ibCard">
            <div class="muted small">Score</div>
            <div class="h1" style="font-size:18px; margin-top:2px">${esc(runs1)}/${esc(wkts1)}</div>
            <div class="muted small" style="margin-top:2px">${esc(oversText1)}/${esc(oversLimit)} ov</div>
          </div>
          <div class="card ibCard">
            <div class="muted small">Run Rate</div>
            <div class="h1" style="font-size:18px; margin-top:2px">${esc(rr1.toFixed(2))}</div>
            <div class="muted small" style="margin-top:2px">RR in 1st innings</div>
          </div>
          <div class="card ibCard">
            <div class="muted small">Extras</div>
            <div class="h1" style="font-size:18px; margin-top:2px">${esc(exTotal)}</div>
            <div class="muted small" style="margin-top:2px">Wd ${esc(exWd)} • Nb ${esc(exNb)} • B ${esc(exB)} • Lb ${esc(exLb)}</div>
          </div>
          <div class="card ibCard">
            <div class="muted small">Top performers</div>
            <div class="muted small" style="margin-top:4px">
              🏏 <b>${esc(topB?.name||"-")}</b> ${topB?`• ${esc(topB.r)} (${esc(topB.b)})`:""}
            </div>
            <div class="muted small" style="margin-top:2px">
              🎯 <b>${esc(bestBo?.name||"-")}</b> ${bestBo?`• ${esc(bestBo.w)}/${esc(bestBo.r)}`:""}
            </div>
          </div>
        </div>



        <div class="grid cols2" style="gap:10px">
          <div class="card" style="padding:10px; border:1px solid var(--border)">
            <div class="muted small">Chasing</div>
            <div class="h1" style="font-size:16px; margin-top:2px">${esc(bat2)}</div>
            <div class="muted small" style="margin-top:4px">Target: <b>${esc(target)}</b> in <b>${esc(oversLimit)}</b> overs</div>
          </div>
          <div class="card" style="padding:10px; border:1px solid var(--border)">
            <div class="muted small">Bowling</div>
            <div class="h1" style="font-size:16px; margin-top:2px">${esc(bowl2)}</div>
            <div class="muted small" style="margin-top:4px">Select opening bowler below</div>
          </div>
        </div>

        <div class="muted small" style="margin:10px 0 6px">2nd Innings setup (Striker / Non-striker / Opening bowler)</div>

        <div class="grid" style="grid-template-columns: 1fr; gap:10px">
          <div>
            <div class="muted small" style="margin:0 0 4px">Striker</div>
            <select class="input" id="ibStriker">
              ${batXI.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join("")}
            </select>
          </div>
          <div>
            <div class="muted small" style="margin:0 0 4px">Non-Striker</div>
            <select class="input" id="ibNonStriker">
              ${batXI.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join("")}
            </select>
          </div>
          <div>
            <div class="muted small" style="margin:0 0 4px">Opening Bowler</div>
            <select class="input" id="ibBowler">
              ${bowlXI.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="row" style="justify-content:flex-end; gap:10px; margin-top:12px">
          <button class="btn ok" id="ibStart">Start 2nd Innings</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const strikerEl = overlay.querySelector("#ibStriker");
    const nonEl = overlay.querySelector("#ibNonStriker");
    const bowlEl = overlay.querySelector("#ibBowler");

    // Make default non-striker different if possible
    if(nonEl && strikerEl && nonEl.value === strikerEl.value && nonEl.options.length>1){
      nonEl.selectedIndex = 1;
    }

    overlay.querySelector("#ibStart")?.addEventListener("click", async ()=>{
      const s = (strikerEl?.value||"").trim();
      const ns = (nonEl?.value||"").trim();
      const bo = (bowlEl?.value||"").trim();
      if(!s || !ns || !bo){
        showState("2nd innings setup: select striker, non-striker aur bowler.", false);
        return;
      }
      if(s===ns){
        showState("Striker aur Non-striker same nahi ho sakte.", false);
        return;
      }
      try{
        // Safe to call even if inningsIndex already flipped to 1
        await startSecondInnings(FB, matchId);
        await setOpeningSetup(FB, matchId, s, ns, bo);
        overlay.remove();
        showState("2nd innings started. Scoring shuru karo.", true);
      } catch(err){
        showState(err?.message || "2nd innings setup failed", false);
      }
    });
  } catch(e){
    // no-op
  }
}



function computeMatchResult(doc){
  try{
    const st = doc?.state || {};
    const i0 = st?.innings?.[0];
    const i1 = st?.innings?.[1];
    if(!i0 || !i1) return null;

    const totalOvers = Number(st.oversPerInnings || doc?.oversPerInnings || 10);
    const totalBalls = Math.max(0, totalOvers * 6);

    const r1 = Number(i0.runs||0), w1 = Number(i0.wkts||0);
    const r2 = Number(i1.runs||0), w2 = Number(i1.wkts||0);
    const balls2 = Number(i1.balls||0);

    const bat1 = (i0.batting || doc?.battingFirst || doc?.a || "").toString();
    const bat2 = (i1.batting || i0.bowling || doc?.bowlingFirst || doc?.b || "").toString();

    // When match marked completed, assume innings are final; otherwise check completion heuristics
    const inn2Done = (doc?.status === "COMPLETED") || (w2>=10) || (balls2>=totalBalls);

    if(!inn2Done) return null;

    if(r2 > r1){
      const wktsLeft = Math.max(0, 10 - w2);
      return {
        winner: bat2,
        loser: bat1,
        type: "wickets",
        margin: wktsLeft,
        text: `${bat2} won by ${wktsLeft} wicket${wktsLeft===1?"":"s"}`
      };
    }
    if(r2 < r1){
      const runsLeft = Math.max(0, r1 - r2);
      return {
        winner: bat1,
        loser: bat2,
        type: "runs",
        margin: runsLeft,
        text: `${bat1} won by ${runsLeft} run${runsLeft===1?"":"s"}`
      };
    }
    return { winner:"", loser:"", type:"tie", margin:0, text:"Match Tied" };
  }catch(e){
    return null;
  }
}

function ensureResultLine(){
  const meta = $("sMeta");
  if(!meta) return null;
  let el = document.getElementById("matchResultLine");
  if(!el){
    el = document.createElement("div");
    el.id = "matchResultLine";
    el.className = "muted small";
    el.style.marginTop = "6px";
    meta.insertAdjacentElement("afterend", el);
  }
  return el;
}

function showResultPopup(doc, awards){
  const res = computeMatchResult(doc);
  if(!res) return;

  const st = doc?.state || {};
  const i0 = st?.innings?.[0] || {};
  const i1 = st?.innings?.[1] || {};
  const line1 = `${esc(i0.batting||doc?.a||"Team A")} ${esc(i0.runs||0)}/${esc(i0.wkts||0)} (${esc(i0.overs||"0.0")})`;
  const line2 = `${esc(i1.batting||doc?.b||"Team B")} ${esc(i1.runs||0)}/${esc(i1.wkts||0)} (${esc(i1.overs||"0.0")})`;

  const mom = awards?.mom;
  const momDetParts = [];
  if(mom?.runs!=null) momDetParts.push(`R ${esc(mom.runs)}`);
  if(mom?.wkts!=null) momDetParts.push(`W ${esc(mom.wkts)}`);
  if(mom?.sixes!=null) momDetParts.push(`6s ${esc(mom.sixes)}`);
  if(mom?.fours!=null) momDetParts.push(`4s ${esc(mom.fours)}`);
  const momDet = momDetParts.length ? momDetParts.join(" • ") : (mom?.score!=null?`Impact ${esc(mom.score)}`:"");
  const six = awards?.sixerKing;
  const bb = awards?.bestBowler;

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="popup" style="max-width:720px">
      <div class="row" style="justify-content:space-between; gap:12px; align-items:center">
        <div>
          <div class="h1" style="font-size:18px">Match Result</div>
          <div class="muted small" style="margin-top:2px">Auto computed (rules-based)</div>
        </div>
        <button class="btn" id="resClose">Close</button>
      </div>

      <div style="margin-top:12px">
        <div class="chip" style="display:inline-flex; font-size:14px; padding:8px 12px">
          🏆 <b style="margin-left:6px">${esc(res.text)}</b>
        </div>

        <div class="card" style="margin-top:12px; padding:12px; background:#f7f9ff">
          <div class="muted small">Summary</div>
          <div style="margin-top:6px"><b>${line1}</b></div>
          <div style="margin-top:4px"><b>${line2}</b></div>
        </div>

        ${
          (mom||six||bb) ? `
          <div class="card" style="margin-top:12px; padding:12px">
            <div class="muted small">Awards</div>
            <div style="margin-top:6px; line-height:1.35">
              ${mom?`🏅 <b>MoM:</b> ${esc(mom.name||"-")} ${mom.team?`<span class="muted">(${esc(mom.team)})</span>`:""}`:""}
              ${six?`<br>💥 <b>Sixer King:</b> ${esc(six.name||"-")} ${six.team?`<span class="muted">(${esc(six.team)})</span>`:""}`:""}
              ${bb?`<br>🎯 <b>Best Bowler:</b> ${esc(bb.name||"-")} ${bb.team?`<span class="muted">(${esc(bb.team)})</span>`:""}`:""}
            </div>
            <div class="muted small" style="margin-top:8px">Tip: Full awards details dekhne ke liye Awards popup open kar sakte hain.</div>
          </div>` : ""
        }

        <div class="row wrap" style="gap:10px; margin-top:12px; justify-content:flex-end">
          <a class="btn" href="summary.html?match=${encodeURIComponent(doc.matchId||matchId)}">View Summary</a>
          <a class="btn" href="scorecard.html?match=${encodeURIComponent(doc.matchId||matchId)}">View Scorecard</a>
          <button class="btn" id="resAwards">Awards</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector("#resClose")?.addEventListener("click", ()=> overlay.remove());
  overlay.addEventListener("click", (e)=>{ if(e.target === overlay) overlay.remove(); });
  overlay.querySelector("#resAwards")?.addEventListener("click", ()=>{
    overlay.remove();
    if(doc?.awards) showAwardsPopup(doc.awards);
    else if(awards) showAwardsPopup(awards);
  });
}


function showAwardsPopup(awards){
  if(!awards) return;
  const mom = awards.mom;
  const six = awards.sixerKing;
  const bb = awards.bestBowler;

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="popup">
      <div class="row" style="justify-content:space-between; gap:12px; align-items:center">
        <div>
          <div class="h1" style="font-size:18px">Match Awards</div>
          <div class="muted small" style="margin-top:2px">Auto calculated (rules-based)</div>
        </div>
        <button class="btn" id="awClose">Close</button>
      </div>

      <div class="awardsGrid" style="margin-top:12px">
        <div class="awardCard awardMom">
          <div class="awardTitle">🏅 Man of the Match</div>
          <div class="awardName">${esc(mom?.name||"-")}</div>
          <div class="awardMeta">${esc(mom?.team||"")} ${mom?.score!=null?` • Score ${esc(mom.score)}`:""}</div>
          <div class="muted small" style="margin-top:6px; line-height:1.25">How computed: <b>Bat</b>(Runs + 4s×1 + 6s×2) + <b>Bowl</b>(Wkts×25 + max(0, 20 − Eco×2)) + <b>Field</b>(C×10 + RO×12 + St×12)</div>
        </div>

        <div class="awardCard awardSix">
          <div class="awardTitle">💥 Sixer King Award</div>
          <div class="awardName">${esc(six?.name||"-")}</div>
          <div class="awardMeta">${esc(six?.team||"")} ${six?.sixes!=null?` • 6s ${esc(six.sixes)}`:""}</div>
        </div>

        <div class="awardCard awardBowl">
          <div class="awardTitle">🎯 Best Bowler Award</div>
          <div class="awardName">${esc(bb?.name||"-")}</div>
          <div class="awardMeta">${esc(bb?.team||"")} ${bb?.wickets!=null?` • ${esc(bb.wickets)}W`:""}${bb?.econ!=null?` • Eco ${esc(bb.econ)}`:""}</div>
        </div>
      </div>

      <div class="muted small" style="margin-top:12px">Tip: Awards edit karne ho to Admin panel me manual override future me add kar sakte hain.</div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector("#awClose")?.addEventListener("click", ()=>overlay.remove());
  overlay.addEventListener("click", (e)=>{ if(e.target===overlay) overlay.remove(); });
}


// ===== Final Result Screen (hide scorer UI, show colorful result + awards) =====
function showFinalResultScreen(doc, awards){
  const aw = deriveAwardsForUI(doc);
  if(!awards || !awards.mom) awards = aw;
  try{
    const rv = document.getElementById("resultView");
    const wa = document.getElementById("scorerWorkArea");
    const btnStart = document.getElementById("btnStart");
    const btnEnd = document.getElementById("btnEnd");
    const btnSO = document.getElementById("btnSuperOver");
    if(!rv) return;

    // hide scoring work area + start/end buttons (keep reset for admin if needed)
    if(wa) wa.style.display = "none";
    if(btnStart) btnStart.style.display = "none";
    if(btnEnd) btnEnd.style.display = "none";
    if(btnSO) btnSO.style.display = "none";

    rv.style.display = "block";

    const meta = document.getElementById("finalMeta");
    if(meta){
      meta.textContent = `${doc?.a||""} vs ${doc?.b||""} • Match ${doc?.matchId||""} • Group ${doc?.group||"-"} • ${doc?.time||""}`;
    }

    const pill = document.getElementById("finalStatusPill");
    if(pill) pill.textContent = (doc?.status||"COMPLETED");

    const r = computeMatchResult(doc) || (doc?.result||"");
    const rt = (typeof r === "string") ? r : (r?.text || r?.label || "");
    const resText = document.getElementById("finalResultText");
    if(resText){
      resText.textContent = rt ? `Match Result: ${rt}` : "Match completed.";
    }

    // Score lines (best-effort, avoid breaking if structure differs)
    const lines = document.getElementById("finalScoreLines");
    if(lines){
      const st = doc?.state || {};
      const inn = st?.innings || [];
      const parts = [];
      if(inn[0]){
        const s0 = (inn[0]?.score || inn[0]?.runs || "") ;
        const w0 = (inn[0]?.wickets ?? inn[0]?.wkts ?? "");
        const o0 = (inn[0]?.oversText || inn[0]?.ov || "");
        const label0 = inn[0]?.battingTeam || doc?.a || "Innings 1";
        parts.push(`<div class="line">${esc(label0)}: ${esc(String(s0))}${w0!==""?"/"+esc(String(w0)):""} ${o0?`• Overs ${esc(String(o0))}`:""}</div>`);
      }
      if(inn[1]){
        const s1 = (inn[1]?.score || inn[1]?.runs || "") ;
        const w1 = (inn[1]?.wickets ?? inn[1]?.wkts ?? "");
        const o1 = (inn[1]?.oversText || inn[1]?.ov || "");
        const label1 = inn[1]?.battingTeam || doc?.b || "Innings 2";
        parts.push(`<div class="line">${esc(label1)}: ${esc(String(s1))}${w1!==""?"/"+esc(String(w1)):""} ${o1?`• Overs ${esc(String(o1))}`:""}</div>`);
      }
      // Super over score if present
      const so = st?.superOver;
      if(so && (so.innings || so.i1 || so.i2)){
        const si = so.innings || [];
        if(si[0]){
          const rs = (si[0]?.runs ?? si[0]?.score ?? "");
          const wk = (si[0]?.wickets ?? "");
          parts.push(`<div class="line">Super Over 1: ${esc(String(rs))}${wk!==""?"/"+esc(String(wk)):""}</div>`);
        }
        if(si[1]){
          const rs = (si[1]?.runs ?? si[1]?.score ?? "");
          const wk = (si[1]?.wickets ?? "");
          parts.push(`<div class="line">Super Over 2: ${esc(String(rs))}${wk!==""?"/"+esc(String(wk)):""}</div>`);
        }
      }
      lines.innerHTML = parts.join("") || "";
    }

    const aw = awards || doc?.awards;
    const grid = document.getElementById("finalAwards");
    if(grid){
      const mom = aw?.mom;
      const six = aw?.sixerKing;
      const bb = aw?.bestBowler; // treated as Most Wickets / Best Bowler
      grid.innerHTML = `
        <div class="awardCard awardMom">
          <div class="awardTitle">🏅 Man of the Match</div>
          <div class="awardName">${esc(mom?.name||"-")}</div>
          <div class="awardMeta">${esc(mom?.team||"")}${mom?.points!=null?` • Points ${esc(String(mom.points))}`:""}</div>
        </div>
        <div class="awardCard awardSix">
          <div class="awardTitle">💥 Most Sixes</div>
          <div class="awardName">${esc(six?.name||"-")}</div>
          <div class="awardMeta">${esc(six?.team||"")}${six?.sixes!=null?` • ${esc(String(six.sixes))} sixes`:""}</div>
        </div>
        <div class="awardCard awardBowler">
          <div class="awardTitle">🎯 Most Wickets</div>
          <div class="awardName">${esc(bb?.name||"-")}</div>
          <div class="awardMeta">${esc(bb?.team||"")}${bb?.wkts!=null?` • ${esc(String(bb.wkts))} wkts`:(bb?.wickets!=null?` • ${esc(String(bb.wickets))} wkts`:"")}</div>
        </div>
      `;
    }
  }catch(e){
    console.warn("showFinalResultScreen failed", e);
  }
}

function exitFinalResultScreen(){
  const rv = document.getElementById("resultView");
  const wa = document.getElementById("scorerWorkArea");
  const btnStart = document.getElementById("btnStart");
  const btnEnd = document.getElementById("btnEnd");
  const btnSO = document.getElementById("btnSuperOver");
  if(rv) rv.style.display = "none";
  if(wa) wa.style.display = "";
  if(btnStart) btnStart.style.display = "";
  if(btnEnd) btnEnd.style.display = "";
  // btnSO display managed by existing logic
  if(btnSO) ; 
}


function squadOf(team){
  const list = SQUADS?.[team];
  if(Array.isArray(list) && list.length) return list;
  const base = (team||"Team").toString().trim() || "Team";
  return Array.from({length:15}, (_,i)=>`${base} Player ${i+1}`);
}

function playingXIOf(state, team){
  const xi = state?.playingXI?.[team];
  if(Array.isArray(xi) && xi.length===11) return xi;
  return null;
}

function playingXIMetaOf(state, team){
  return state?.playingXIMeta?.[team] || null;
}

function fillSelect(sel, list, placeholder){
  if(!sel) return;
  const keep = sel.value;
  sel.innerHTML = "";
  const o0 = document.createElement("option");
  o0.value = "";
  o0.textContent = placeholder || "Select...";
  sel.appendChild(o0);
  for(const n of list){
    const o = document.createElement("option");
    o.value = n;
    o.textContent = n;
    sel.appendChild(o);
  }
  if(keep && list.includes(keep)) sel.value = keep;
}

function currentInnings(doc){
  const st = doc?.state;
  const idx = Number(st?.inningsIndex||0);
  return st?.innings?.[idx] || null;
}

function battingBowlingTeams(doc){
  const st = doc?.state || {};
  const inn = currentInnings(doc);
  const summary = doc?.summary || st.summary || {};
  return {
    batting: inn?.batting || summary.batting || doc?.a,
    bowling: inn?.bowling || summary.bowling || doc?.b
  };
}

function ensureDropdowns(doc){
  const st = doc?.state || {};
  const { batting, bowling } = battingBowlingTeams(doc);

  const batXI = playingXIOf(st, batting);
  const bowlXI = playingXIOf(st, bowling);

  const batList = batXI || squadOf(batting);
  const bowlList = bowlXI || squadOf(bowling);

  fillSelect($("batter"), batList, `Select striker (${batting})...`);
  fillSelect($("nonStriker"), batList, `Select non-striker (${batting})...`);
  fillSelect($("bowler"), bowlList, `Select bowler (${bowling})...`);

  // ✅ Auto-apply saved onField (wizard/opening setup) so scoring can start immediately
  const inn = currentInnings(doc);
  const of = inn?.onField || {};
  const bSel = $("batter");
  const nSel = $("nonStriker");
  const boSel = $("bowler");

  if(bSel && of.striker) bSel.value = of.striker;
  if(nSel && of.nonStriker) nSel.value = of.nonStriker;
  if(boSel && of.bowler) boSel.value = of.bowler;

  // Fallback: if still blank, pick first sensible defaults
  if(bSel && !bSel.value && Array.isArray(batList) && batList.length) bSel.value = batList[0];
  if(nSel && (!nSel.value || nSel.value===bSel?.value) && Array.isArray(batList) && batList.length>1){
    nSel.value = batList.find(x=>x!==bSel.value) || batList[1];
  }
  if(boSel && !boSel.value && Array.isArray(bowlList) && bowlList.length) boSel.value = bowlList[0];
}

function fmtOversFromBalls(balls){
  const o = Math.floor((Number(balls||0))/6);
  const b = (Number(balls||0))%6;
  return `${o}.${b}`;
}

function renderScorerLiveChip(doc){
  const box = $("scorerLiveChip");
  if(!box) return;
  const st = doc?.state || {};
  const inn = currentInnings(doc);
  if(!inn){
    box.innerHTML = `<div class="muted small">Live chip</div><div class="muted small">No innings.</div>`;
    return;
  }
  const of = inn.onField || {};
  const striker = (of.striker||"").trim();
  const nonStriker = (of.nonStriker||"").trim();
  const bowler = (of.bowler||"").trim();

  const sb = striker ? (inn.batters?.[striker] || {}) : {};
  const ns = nonStriker ? (inn.batters?.[nonStriker] || {}) : {};
  const bo = bowler ? (inn.bowlers?.[bowler] || {}) : {};

  const score = `${inn.runs||0}/${inn.wkts||0}`;
  const overs = `${inn.overs||"0.0"}`;
  const pp = Number(st.powerplayOvers ?? doc?.powerplayOvers ?? 3);
  const inPP = !!(st.summary?.inPowerplay);

  // Chase metrics (innings 2)
  const totalOvers = Number(st.oversPerInnings || doc?.oversPerInnings || 10);
  const totalBalls = Math.max(0, totalOvers * 6);
  const i1 = st?.innings?.[0];
  const isChase = (Number(st.inningsIndex||0) === 1 && !!i1);
  const i1Complete = isChase && (
    Number(i1.balls||0) >= totalBalls ||
    Number(i1.wkts||0) >= 10 ||
    Number(st.inningsIndex||0) >= 1
  );
  let chaseLine = "";
  if(isChase && i1Complete){
    const target = Number(i1.runs||0) + 1;
    const ballsUsed = Number(inn.balls||0);
    const ballsLeft = Math.max(0, totalBalls - ballsUsed);
    const runs = Number(inn.runs||0);
    const runsNeeded = Math.max(0, target - runs);
    const reqRR = ballsLeft > 0 ? Math.round(((runsNeeded*6)/ballsLeft)*100)/100 : 0;
    chaseLine = `
      <div class="muted small" style="margin-top:4px">
        <b>Target</b> ${esc(target)} <span class="muted">•</span>
        ${runsNeeded<=0 ? `<b>Target achieved</b>` : `<b>Need</b> ${esc(runsNeeded)} in ${esc(ballsLeft)} balls`}
        <span class="muted">•</span> <b>Req RR</b> ${esc(reqRR)}
      </div>
    `;
  }

  const ppLine = inPP ? `
      <div class="muted small" style="margin-top:4px">
        <b>Powerplay</b> • Overs 1-${esc(pp)}
      </div>
    ` : "";

  const fhLine = of.freeHit ? `
      <div class="muted small" style="margin-top:4px">
        <b>FREE HIT</b>
      </div>
    ` : "";

  const bowOvers = bowler ? fmtOversFromBalls(bo.oBalls||0) : "-";

  box.innerHTML = `
    <div class="row wrap" style="justify-content:space-between; gap:10px; align-items:flex-start">
      <div>
        <div class="muted small">LIVE • ${esc(inn.batting||"")}</div>
        <div style="margin-top:4px"><b>${esc(score)}</b> <span class="muted">(${esc(overs)})</span></div>
        ${ppLine}
        ${fhLine}
        ${chaseLine}
      </div>
      <a class="chip" href="scorecard.html?match=${encodeURIComponent(doc.matchId||matchId)}" style="text-decoration:none">Scorecard</a>
    </div>

    <div class="sep" style="margin:10px 0"></div>

    <div class="grid cols2" style="gap:8px">
      <div>
        <div class="muted small">Batters</div>
        <div style="margin-top:4px">
          <div><b>${esc(striker||"-")}</b>${striker?" *":""} <span class="muted">${striker?` ${sb.r||0}(${sb.b||0})`:""}</span></div>
          <div><b>${esc(nonStriker||"-")}</b> <span class="muted">${nonStriker?` ${ns.r||0}(${ns.b||0})`:""}</span></div>
        </div>
      </div>
      <div>
        <div class="muted small">Bowler</div>
        <div style="margin-top:4px">
          <div><b>${esc(bowler||"-")}</b></div>
          <div class="muted small">O ${esc(bowOvers)} • R ${esc(bo.r||0)} • W ${esc(bo.w||0)}</div>
        </div>
      </div>
    </div>
  `;
}

function requireNames(){
  const batter = $("batter")?.value?.trim();
  const nonStriker = $("nonStriker")?.value?.trim();
  const bowler = $("bowler")?.value?.trim();
  if(!batter || !nonStriker){
    showState("Striker & non-striker select karo.", false);
    return null;
  }
  if(batter===nonStriker){
    showState("Striker aur non-striker same nahi ho sakte.", false);
    return null;
  }
  if(!bowler){
    showState("Bowler select karo.", false);
    return null;
  }

  // Wicket flow enforcement: next batter must be assigned before any next delivery.
  const inn = currentInnings(CURRENT_DOC);
  const of = inn?.onField;
  if(of?.needNextBatter){
    showState("Wicket hua hai. Pehele Wicket flow me next batsman select karo.", false);
    return null;
  }

  // Over-end enforcement
  // (separate from wicket enforcement)
  if(of?.needNewBowler){
    if(of?.lastBowler && bowler === of.lastBowler){
      showState("Same bowler next over nahi dal sakta. New bowler select karo.", false);
      return null;
    }
  }

  // Max 2-over (or configured) restriction
  const st = CURRENT_DOC?.state || {};
  const maxO = Number(st.maxOversPerBowler ?? 2);
  const maxBalls = Math.max(0, maxO*6);
  if(maxBalls>0){
    const inn = currentInnings(CURRENT_DOC);
    const oBalls = Number(inn?.bowlers?.[bowler]?.oBalls || 0);
    if(oBalls >= maxBalls){
      showState(`${bowler} max ${maxO} overs complete. New bowler select karo.`, false);
      return null;
    }
  }

  return { batter, nonStriker, bowler };
}

async function safeAddBall(ball){
  try{
    await addBall(FB, matchId, ball);
  }catch(e){
    const msg = e?.message || String(e);
    // ✅ UX fix:
    // Sometimes the match doc can be missing opening setup (striker/non-striker) even when
    // scorer has already selected them in the Ball input dropdowns.
    // In that case, auto-save opening once (UI convenience only) and retry the ball.
    if(/Opening setup pending/i.test(msg)){
      const n = requireNames();
      if(n){
        try{
          // Save opening (only sets onField striker/nonStriker/bowler + openingDone)
          await setOpeningSetup(FB, matchId, n.batter, n.nonStriker, n.bowler);
          showState("Opening auto-saved ✅ Ab scoring continue karo.", true);
          await addBall(FB, matchId, ball);
          return;
        }catch(e2){
          // fallthrough to normal error reporting
        }
      }
    }

    showState(msg, false);
    alert(msg);
  }
}

// -----------------------------
// Toss Card (inject)
// -----------------------------
function mountTossCard(){
  if(USE_SETUP_WIZARD) return;

  if(_tossMounted) return;
  const batterSel = $("batter");
  if(!batterSel) return;

  const ballCard = batterSel.closest(".card");
  const parent = ballCard ? ballCard.parentElement : null;
  if(!ballCard || !parent) return;

  const tossCard = document.createElement("div");
  tossCard.className = "card";
  tossCard.id = "tossCard";
  tossCard.innerHTML = `
    <div class="h1" style="font-size:16px">Toss & Match Setup</div>
    <div class="muted small" style="margin-top:4px">Pehele toss set karo. Phir Playing XI select karo. Phir Start Match (LIVE).</div>
    <hr class="sep"/>

    <div class="grid cols2">
      <div>
        <div class="muted small">Toss winner</div>
        <select id="tossWinner" class="input">
          <option value="">Select team…</option>
        </select>
      </div>
      <div>
        <div class="muted small">Decision</div>
        <select id="tossDecision" class="input">
          <option value="BAT">Bat</option>
          <option value="BOWL">Bowl</option>
        </select>
      </div>
    </div>

    <div style="margin-top:10px" class="row wrap">
      <button class="btn ok" id="btnSaveToss" type="button">Save Toss</button>
      <div class="muted small" id="tossMsg"></div>
    </div>
  `;

  parent.insertBefore(tossCard, ballCard);
  _tossMounted = true;

  $("btnSaveToss")?.addEventListener("click", async ()=>{
    const winner = $("tossWinner")?.value?.trim();
    const decision = $("tossDecision")?.value?.trim() || "BAT";
    if(!winner) return alert("Toss winner select karo");
    try{
      await setToss(FB, matchId, winner, decision);
      $("tossMsg").textContent = "Toss saved ✅ Ab Playing XI select karo.";
    }catch(e){
      alert(e?.message || String(e));
    }
  });
}

function updateTossUI(doc){
  if(USE_SETUP_WIZARD) return;

  if(!_tossMounted) mountTossCard();
  const winnerSel = $("tossWinner");
  if(!winnerSel) return;

  const teams = [doc?.a, doc?.b].filter(Boolean);
  fillSelect(winnerSel, teams, "Select team…");

  const st = doc?.state || {};
  const hasToss = !!(st.toss || doc?.tossWinner);
  const hasXI = !!(st.playingXI && st.playingXI[doc.a]?.length===11 && st.playingXI[doc.b]?.length===11);
  const idx = Number(st?.inningsIndex||0);
  const card = $("tossCard");
  const msg = $("tossMsg");

  // ✅ UX: 2nd innings me toss repeat nahi dikhana
  if(idx>=1 && hasToss && hasXI){
    if(card) card.style.display = "none";
    return;
  }

  if(card){
    // Show whenever toss not set (even if match accidentally flipped to LIVE)
    card.style.display = (!hasToss) ? "block" : (doc?.status==="UPCOMING" ? "block" : "none");
  }
  if(msg){
    if(hasToss){
      const t = st.toss || { winner: doc.tossWinner, decision: doc.tossDecision };
      msg.textContent = `Saved: ${t.winner} won, chose ${t.decision}.`;
    } else {
      msg.textContent = "Toss pending.";
    }
  }
}

// -----------------------------
// Playing XI Card (inject)
// -----------------------------
function mountPlayingXICard(){
  if(USE_SETUP_WIZARD) return;

  if(_xiMounted) return;

  const batterSel = $("batter");
  const ballCard = batterSel ? batterSel.closest(".card") : null;
  const parent = ballCard ? ballCard.parentElement : null;
  if(!parent || !ballCard) return;

  const xiCard = document.createElement("div");
  xiCard.className = "card";
  xiCard.id = "xiCard";
  xiCard.innerHTML = `
    <div class="h1" style="font-size:16px">Playing XI (11 out of 15)</div>
    <div class="muted small" style="margin-top:4px">Dono teams ke 11-11 players select karo. Saath me <b>Captain</b>, <b>Vice-Captain</b> aur <b>Wicket Keeper</b> mandatory select karo.</div>
    <hr class="sep"/>

    <div class="grid cols2">
      <div>
        <div class="muted small" id="xiLabelA">Team A XI</div>
        <div id="xiListA" class="grid" style="gap:6px"></div>
        <div class="muted small" id="xiCountA" style="margin-top:6px">Selected: 0/11</div>

        <div class="grid cols3" style="gap:8px; margin-top:10px">
          <div>
            <div class="muted small">Captain</div>
            <select id="capA" class="input"><option value="">Select…</option></select>
          </div>
          <div>
            <div class="muted small">Vice-Captain</div>
            <select id="vcA" class="input"><option value="">Select…</option></select>
          </div>
          <div>
            <div class="muted small">Wicket-Keeper</div>
            <select id="wkA" class="input"><option value="">Select…</option></select>
          </div>
        </div>
      </div>
      <div>
        <div class="muted small" id="xiLabelB">Team B XI</div>
        <div id="xiListB" class="grid" style="gap:6px"></div>
        <div class="muted small" id="xiCountB" style="margin-top:6px">Selected: 0/11</div>

        <div class="grid cols3" style="gap:8px; margin-top:10px">
          <div>
            <div class="muted small">Captain</div>
            <select id="capB" class="input"><option value="">Select…</option></select>
          </div>
          <div>
            <div class="muted small">Vice-Captain</div>
            <select id="vcB" class="input"><option value="">Select…</option></select>
          </div>
          <div>
            <div class="muted small">Wicket-Keeper</div>
            <select id="wkB" class="input"><option value="">Select…</option></select>
          </div>
        </div>
      </div>
    </div>

    <div class="row wrap" style="margin-top:10px">
      <button class="btn ok" id="btnSaveXI" type="button">Save Playing XI</button>
      <div class="muted small" id="xiMsg"></div>
    </div>
  `;

  // Toss card already above Ball card, so this goes under Toss automatically
  parent.insertBefore(xiCard, ballCard);
  _xiMounted = true;

  $("btnSaveXI")?.addEventListener("click", async ()=>{
    if(!CURRENT_DOC) return;
    const xiA = Array.from(document.querySelectorAll("#xiListA input[type=checkbox]:checked")).map(i=>i.value);
    const xiB = Array.from(document.querySelectorAll("#xiListB input[type=checkbox]:checked")).map(i=>i.value);
    const metaA = { captainId: $("capA")?.value||"", viceCaptainId: $("vcA")?.value||"", wicketKeeperId: $("wkA")?.value||"" };
    const metaB = { captainId: $("capB")?.value||"", viceCaptainId: $("vcB")?.value||"", wicketKeeperId: $("wkB")?.value||"" };
    try{
      await setPlayingXI(FB, matchId, xiA, xiB, metaA, metaB);
      $("xiMsg").textContent = "Playing XI saved ✅";
      showState("Playing XI saved ✅ Ab scoring start kar sakte ho.", true);
    }catch(e){
      alert(e?.message || String(e));
    }
  });
}

function selectedXIFrom(containerId){
  const box = $(containerId);
  if(!box) return [];
  return Array.from(box.querySelectorAll("input[type=checkbox]:checked")).map(i=>i.value).filter(Boolean);
}

function updateXIMetaOptions(side){
  const list = side === "A" ? selectedXIFrom("xiListA") : selectedXIFrom("xiListB");
  const cap = $(side === "A" ? "capA" : "capB");
  const vc  = $(side === "A" ? "vcA"  : "vcB");
  const wk  = $(side === "A" ? "wkA"  : "wkB");
  if(!cap || !vc || !wk) return;
  fillSelect(cap, list, "Select…");
  fillSelect(vc, list, "Select…");
  fillSelect(wk, list, "Select…");
}

function renderXIList(containerId, players, selectedSet, countId){
  const box = $(containerId);
  if(!box) return;

  box.innerHTML = "";
  for(const p of players){
    const row = document.createElement("label");
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.alignItems = "center";
    row.style.cursor = "pointer";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = p;
    cb.checked = selectedSet.has(p);

    cb.addEventListener("change", ()=>{
      const checked = Array.from(box.querySelectorAll("input[type=checkbox]:checked")).length;
      if(checked > 11){
        cb.checked = false;
        alert("Sirf 11 players select kar sakte ho.");
      }
      const finalCount = Array.from(box.querySelectorAll("input[type=checkbox]:checked")).length;
      const cEl = $(countId);
      if(cEl) cEl.textContent = `Selected: ${finalCount}/11`;

      // refresh Captain/VC/WK options based on selected XI
      if(containerId === "xiListA") updateXIMetaOptions("A");
      if(containerId === "xiListB") updateXIMetaOptions("B");
    });

    const sp = document.createElement("span");
    sp.textContent = p;

    row.appendChild(cb);
    row.appendChild(sp);
    box.appendChild(row);
  }

  const cnt = Array.from(box.querySelectorAll("input[type=checkbox]:checked")).length;
  const cEl = $(countId);
  if(cEl) cEl.textContent = `Selected: ${cnt}/11`;
}

function updateXIUI(doc){
  if(USE_SETUP_WIZARD) return;

  if(!_xiMounted) mountPlayingXICard();
  const card = $("xiCard");
  if(!card) return;

  const st = doc?.state || {};
  const idx = Number(st?.inningsIndex||0);
  const hasToss = !!(st.toss || doc?.tossWinner);
  const hasXI = !!(st.playingXI && st.playingXI[doc.a]?.length===11 && st.playingXI[doc.b]?.length===11);

  // ✅ UX: 2nd innings me XI/Leaders repeat nahi dikhana
  if(idx>=1 && hasToss && hasXI){
    card.style.display = "none";
    return;
  }

  // Show whenever XI not set but toss is available (even if match accidentally flipped to LIVE)
  card.style.display = (hasToss && !hasXI) ? "block" : (doc?.status==="UPCOMING" && hasToss ? "block" : "none");

  $("xiLabelA").textContent = `${doc.a} XI`;
  $("xiLabelB").textContent = `${doc.b} XI`;

  const squadA = squadOf(doc.a);
  const squadB = squadOf(doc.b);

  const selA = new Set((st.playingXI?.[doc.a] || []).filter(Boolean));
  const selB = new Set((st.playingXI?.[doc.b] || []).filter(Boolean));

  renderXIList("xiListA", squadA, selA, "xiCountA");
  renderXIList("xiListB", squadB, selB, "xiCountB");

  // Populate Captain/VC/WK dropdowns from selected XI
  updateXIMetaOptions("A");
  updateXIMetaOptions("B");
  const metaA = playingXIMetaOf(st, doc.a);
  const metaB = playingXIMetaOf(st, doc.b);
  if(metaA){ if($("capA")) $("capA").value = metaA.captainId || ""; if($("vcA")) $("vcA").value = metaA.viceCaptainId || ""; if($("wkA")) $("wkA").value = metaA.wicketKeeperId || ""; }
  if(metaB){ if($("capB")) $("capB").value = metaB.captainId || ""; if($("vcB")) $("vcB").value = metaB.viceCaptainId || ""; if($("wkB")) $("wkB").value = metaB.wicketKeeperId || ""; }

  $("xiMsg").textContent = hasXI ? "Saved ✅ (You can re-save if needed)" : "Pending: select 11-11 players.";
}

// -----------------------------
// Innings Break Card (UI only)
// -----------------------------
function mountInningsBreakCard(){
  if(USE_SETUP_WIZARD) return;

  if(_breakMounted) return;
  const batterSel = $("batter");
  const ballCard = batterSel ? batterSel.closest(".card") : null;
  const parent = ballCard ? ballCard.parentElement : null;
  if(!parent || !ballCard) return;

  const br = document.createElement("div");
  br.className = "card";
  br.id = "inningsBreakCard";
  br.innerHTML = `
    <div class="h1" style="font-size:16px">Innings Break</div>
    <div class="muted small" style="margin-top:4px" id="ibNote">1st innings complete. Ab 2nd innings (chase) start karte hain.</div>
    <hr class="sep"/>
    <div class="row" style="justify-content:space-between; gap:12px; align-items:flex-start">
      <div>
        <div class="muted small" id="ibSummary">-</div>
        <div class="h1" style="margin-top:6px; font-size:18px" id="ibTarget">-</div>
      </div>
      <button class="btn ok" id="btnStart2nd" type="button">Start 2nd Innings</button>
    </div>
    <div class="muted small" style="margin-top:10px">Next step: sirf <b>opener batsman</b> + <b>opening bowler</b> select hoga.</div>
  `;

  parent.insertBefore(br, ballCard);
  _breakMounted = true;

  br.querySelector("#btnStart2nd")?.addEventListener("click", ()=>{
    // Open the short wizard (Break -> Opening -> Ready)
    if(!CURRENT_DOC) return;
    // ⛔ Guard: squads ready hone se pehle wizard mat kholo
  if (!SQUADS || !Object.keys(SQUADS).length) {
    return;
  }
  ensureWizard();
    if(WIZARD) WIZARD.open(CURRENT_DOC);
  });
}

function updateInningsBreakUI(doc){
  if(USE_SETUP_WIZARD) return;

  if(!_breakMounted) mountInningsBreakCard();
  const card = document.getElementById("inningsBreakCard");
  if(!card) return;

  const st = doc?.state || {};
  const idx = Number(st?.inningsIndex||0);
  const hasToss = !!(st.toss || doc?.tossWinner);
  const hasXI = !!(st.playingXI && st.playingXI[doc.a]?.length===11 && st.playingXI[doc.b]?.length===11);

  const inn = currentInnings(doc);
  const of = inn?.onField || {};
  const inningsStarted = !!(
    inn && (
      (Number(inn.ballsTotal||0) > 0) ||
      (Number(inn.balls||0) > 0) ||
      ((inn.ballByBall?.length||0) > 0) ||
      (inn.openingDone === true)
    )
  );
  const hasOpening = inningsStarted || !!(of.striker && of.nonStriker && of.bowler);

  // Show only during 2nd innings BEFORE opening is selected
  const show = (idx>=1 && hasToss && hasXI && !hasOpening);
  card.style.display = show ? "block" : "none";
  if(!show) return;

  const i1 = st?.innings?.[0] || {};
  const runs = Number(i1.runs||0);
  const wk = Number(i1.wickets||i1.wkts||0);
  const lb = Number(i1.legalBalls||i1.ballsTotal||i1.balls||0);
  const ov = fmtOversFromBalls(lb);
  const target = runs + 1;

  const { batting } = battingBowlingTeams(doc);
  const summaryEl = document.getElementById("ibSummary");
  const targetEl = document.getElementById("ibTarget");
  if(summaryEl) summaryEl.textContent = `1st Innings: ${runs}/${wk} (${ov} ov)`;
  if(targetEl) targetEl.textContent = `Target for ${batting}: ${target}`;
}

// -----------------------------
// Opening Setup Card (2 openers + opening bowler)
// -----------------------------
function mountOpeningCard(){
  if(USE_SETUP_WIZARD) return;

  if(_openingMounted) return;
  const batterSel = $("batter");
  const ballCard = batterSel ? batterSel.closest(".card") : null;
  const parent = ballCard ? ballCard.parentElement : null;
  if(!parent || !ballCard) return;

  const openCard = document.createElement("div");
  openCard.className = "card";
  openCard.id = "openingCard";
  openCard.innerHTML = `
    <div class="h1" style="font-size:16px">Opening Setup</div>
    <div class="muted small" style="margin-top:4px">Toss + Playing XI ke baad 2 openers aur opening bowler select karo. Iske bina scoring lock rahegi.</div>
    <hr class="sep"/>

    <div class="grid cols3" style="gap:10px">
      <div>
        <div class="muted small">Opener 1 (Striker)</div>
        <select id="opStriker" class="input"><option value="">Select…</option></select>
      </div>
      <div>
        <div class="muted small">Opener 2 (Non-striker)</div>
        <select id="opNonStriker" class="input"><option value="">Select…</option></select>
      </div>
      <div>
        <div class="muted small">Opening Bowler</div>
        <select id="opBowler" class="input"><option value="">Select…</option></select>
        <div class="muted small" style="margin-top:4px">(Bowler wicket-keeper nahi ho sakta)</div>
      </div>
    </div>

    <div class="row wrap" style="margin-top:10px">
      <button class="btn ok" id="btnSaveOpening" type="button">Save Opening</button>
      <div class="muted small" id="openingMsg"></div>
    </div>
  `;

  parent.insertBefore(openCard, ballCard);
  _openingMounted = true;

  $("btnSaveOpening")?.addEventListener("click", async ()=>{
    if(!CURRENT_DOC) return;
    const s = $("opStriker")?.value?.trim();
    const ns = $("opNonStriker")?.value?.trim();
    const bo = $("opBowler")?.value?.trim();
    try{
      await setOpeningSetup(FB, matchId, s, ns, bo);
      $("openingMsg").textContent = "Opening saved ✅ Ab scoring start kar sakte ho.";
      showState("Opening saved ✅", true);
    }catch(e){
      alert(e?.message || String(e));
    }
  });
}

function updateOpeningUI(doc){
  if(USE_SETUP_WIZARD) return;

  if(!_openingMounted) mountOpeningCard();
  const card = $("openingCard");
  if(!card) return;
  const st = doc?.state || {};
  const idx = Number(st?.inningsIndex||0);
  const hasToss = !!(st.toss || doc?.tossWinner);
  const hasXI = !!(st.playingXI && st.playingXI[doc.a]?.length===11 && st.playingXI[doc.b]?.length===11);

  // ✅ UX: 2nd innings me opening selection wizard se hoga (Break -> Opening). Is page par opening card hide.
  if(idx>=1 && hasToss && hasXI){
    card.style.display = "none";
    return;
  }

  const inn = currentInnings(doc);
  const of = inn?.onField || {};
  // Once innings has started (any ball logged), opening setup should never re-appear
  // even if bowler gets cleared for a new over.
  const inningsStarted = !!(
    inn && (
      (Number(inn.ballsTotal||0) > 0) ||
      (Number(inn.balls||0) > 0) ||
      ((inn.ballByBall?.length||0) > 0) ||
      ((inn.openingDone === true)) ||
      (inn.batters && Object.keys(inn.batters).length > 0)
    )
  );

  const hasOpening = inningsStarted || !!(of.striker && of.nonStriker && of.bowler);

  // show only when toss+XI done and opening missing (and innings not started)
  card.style.display = (hasToss && hasXI && !hasOpening) ? "block" : "none";

  if(!(hasToss && hasXI)) return;
  const { batting, bowling } = battingBowlingTeams(doc);
  const batXI = playingXIOf(st, batting) || squadOf(batting);
  const bowlXI = playingXIOf(st, bowling) || squadOf(bowling);

  fillSelect($("opStriker"), batXI, `Select opener (${batting})…`);
  fillSelect($("opNonStriker"), batXI, `Select opener (${batting})…`);

  // remove wicket-keeper from bowler options if known
  const wk = playingXIMetaOf(st, bowling)?.wicketKeeperId;
  const bowlList = wk ? bowlXI.filter(n=>n!==wk) : bowlXI;
  fillSelect($("opBowler"), bowlList, `Select bowler (${bowling})…`);

  if(of.striker) $("opStriker").value = of.striker;
  if(of.nonStriker) $("opNonStriker").value = of.nonStriker;
  if(of.bowler) $("opBowler").value = of.bowler;

  const msg = $("openingMsg");
  if(msg){
    msg.textContent = hasOpening ? `Saved: ${of.striker} & ${of.nonStriker}, Bowler ${of.bowler}` : "Pending.";
  }
}

// -----------------------------
// Wicket Modal (dropdown based + fielder)
// -----------------------------
const WICKET_TYPES = ["Bowled","Caught","Run Out","Stumped","Hit Wicket","Retired Hurt","Retired Out"];

function allowedWicketTypes(freeHit, delivery){
  const d = (delivery||"LEGAL").toString().toUpperCase();
  if(freeHit && d === "LEGAL") return ["Run Out","Retired Hurt","Retired Out"];
  if(d === "NB") return ["Run Out","Retired Hurt","Retired Out"];
  if(d === "WD") return ["Run Out","Stumped","Retired Hurt","Retired Out"];
  return WICKET_TYPES;
}

function setWicketTypeOptions(list, selected){
  const sel = $("outType");
  if(!sel) return;
  sel.innerHTML = list.map(t=>`<option value="${t}">${t}</option>`).join("");
  if(selected && list.includes(selected)) sel.value = selected;
}

function openWicketModal(doc){
  const modal = $("wicketModal");
  if(!modal) return alert("wicketModal missing in scorer.html");
  modal.style.display = "block";
  $("wicketMsg").textContent = "";

  const st = doc.state || {};
  const inn = currentInnings(doc) || st.innings?.[0] || {};
  const of = inn.onField || {};
  const { batting, bowling } = battingBowlingTeams(doc);

  const freeHit = !!of.freeHit;
  const deliveryNow = $("wDelivery")?.value || "LEGAL";
  setWicketTypeOptions(allowedWicketTypes(freeHit, deliveryNow), $("outType")?.value||"");

  // Update wicket types live when delivery type changes
  const wDel = $("wDelivery");
  if(wDel && !wDel.__wktBound){
    wDel.__wktBound = true;
    wDel.addEventListener("change", ()=>{
      const d = wDel.value || "LEGAL";
      const list = allowedWicketTypes(!!window.__WKT_FREE_HIT, d);
      setWicketTypeOptions(list, $("outType")?.value||"");
    });
  }
  window.__WKT_FREE_HIT = freeHit;

  // hint
  if($("wicketMsg")){
    if(freeHit){
      $("wicketMsg").textContent = "FREE HIT: Legal ball par sirf Run Out allowed.";
    } else {
      $("wicketMsg").textContent = "";
    }
  }

  const outs = [of.striker, of.nonStriker].filter(Boolean);
  $("outBatter").innerHTML = outs.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join("");

  const xiBat = playingXIOf(st, batting) || squadOf(batting);

  const outSet = new Set();
  Object.entries(inn.batters||{}).forEach(([name, b])=>{ if(b?.out) outSet.add(name); });

  const eligible = xiBat.filter(n=>{
    if(!n) return false;
    if(n===of.striker || n===of.nonStriker) return false;
    if(outSet.has(n)) return false;
    return true;
  });

  $("nextBatter").innerHTML = `<option value="">Select next batter…</option>` +
    eligible.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join("");

  const xiField = playingXIOf(st, bowling) || squadOf(bowling);
  fillSelect($("outFielder"), xiField, `Select fielder (${bowling})…`);
}

function closeWicketModal(){
  const modal = $("wicketModal");
  if(modal) modal.style.display = "none";
}

$("wicketCancel")?.addEventListener("click", closeWicketModal);
$("wicketX")?.addEventListener("click", closeWicketModal);

$("wicketSave")?.addEventListener("click", async ()=>{
  if(!CURRENT_DOC) return;

  const names = requireNames();
  if(!names) return;

  const outType = ($("outType")?.value || "Bowled").trim();
  const delivery = ($("wDelivery")?.value || "LEGAL").trim();
  const wRuns = Number($("wRuns")?.value || 0);
  const crossed = !!$("wCrossed")?.checked;
  const outBatter = ($("outBatter")?.value || "").trim();
  const nextBatter = ($("nextBatter")?.value || "").trim();
  const fielder = ($("outFielder")?.value || "").trim();

  const kindLc = outType.toLowerCase();
  const stFH = CURRENT_DOC?.state || {};
  const innFH = currentInnings(CURRENT_DOC) || stFH.innings?.[Number(stFH.inningsIndex||0)] || {};
  const freeHit = !!innFH?.onField?.freeHit;
  // Enforce rules on UI as well (core also validates)
  if(freeHit && delivery.toUpperCase()==="LEGAL" && kindLc!=="run out"){
    $("wicketMsg").textContent = "FREE HIT: Legal ball par sirf Run Out allowed.";
    return;
  }
  if(delivery.toUpperCase()==="NB" && kindLc!=="run out"){
    $("wicketMsg").textContent = "NO-BALL par wicket (Bowled/Caught/LBW/Stumped...) allowed nahi. Sirf Run Out.";
    return;
  }
  if(delivery.toUpperCase()==="WD" && !(kindLc==="run out" || kindLc==="stumped")){
    $("wicketMsg").textContent = "WIDE par sirf Run Out ya Stumped allowed.";
    return;
  }
  const needsFielder = (kindLc==="caught" || kindLc==="run out" || kindLc==="stumped");
  const isRetHurt = (kindLc==="retired hurt");

  if(!outBatter){
    $("wicketMsg").textContent = "Out batsman select karo.";
    return;
  }
  if(needsFielder && !fielder){
    $("wicketMsg").textContent = "Fielder select karo (fielding XI).";
    return;
  }

  const inn = currentInnings(CURRENT_DOC) || {};
  const wktsNow = Number(inn.wkts||0);
  const lastWicket = wktsNow >= 9;
  if(!isRetHurt && !lastWicket && !nextBatter){
    $("wicketMsg").textContent = "Next batsman select karo.";
    return;
  }

  closeWicketModal();

  await safeAddBall({
    type: "WICKET",
    runs: wRuns,
    batter: names.batter,
    nonStriker: names.nonStriker,
    bowler: names.bowler,
    delivery, // LEGAL|WD|NB
    wicketKind: outType,
    outBatter,
    nextBatter: nextBatter || null,
    fielder: fielder || null,
    crossed
  });
});

// -----------------------------
// Bowler Modal (Over-end UX)
// -----------------------------
let LAST_BOWLER_MODAL_KEY = "";

function openBowlerModal(doc){
  const modal = $("bowlerModal");
  if(!modal) return;
  const st = doc?.state || {};
  const inn = currentInnings(doc) || st.innings?.[Number(st.inningsIndex||0)] || {};
  const of = inn.onField || {};
  if(!of.needNewBowler) return;

  const key = `${Number(st.inningsIndex||0)}-${Number(inn.balls||0)}`;
  if(LAST_BOWLER_MODAL_KEY === key) return;

  const { bowling } = battingBowlingTeams(doc);
  const xiBowl = playingXIOf(st, bowling) || squadOf(bowling);
  const wk = playingXIMetaOf(st, bowling)?.wicketKeeperId;
  const last = (of.lastBowler||"").trim();
  const list = xiBowl.filter(n=>n && n!==wk && n!==last);

  fillSelect($("nextBowlerSel"), list, `Select bowler (${bowling})…`);
  $("bowlerModalMsg").textContent = "";
  modal.style.display = "block";
  LAST_BOWLER_MODAL_KEY = key;

  setTimeout(()=>{ try{ $("nextBowlerSel")?.focus(); }catch(e){} }, 0);
}

function closeBowlerModal(){
  const modal = $("bowlerModal");
  if(modal) modal.style.display = "none";
}

$("bowlerCancel")?.addEventListener("click", closeBowlerModal);
$("bowlerX")?.addEventListener("click", closeBowlerModal);
$("bowlerSave")?.addEventListener("click", ()=>{
  const sel = ($("nextBowlerSel")?.value || "").trim();
  if(!sel){
    $("bowlerModalMsg").textContent = "Bowler select karo.";
    return;
  }
  // set main bowler dropdown; will be persisted on next ball
  const main = $("bowler");
  if(main) main.value = sel;
  closeBowlerModal();
  showState(`Bowler set: ${sel}`, true);
});

// -----------------------------
// Buttons
// -----------------------------
$("btnStart")?.addEventListener("click", async ()=>{
  const st = CURRENT_DOC?.state || {};
  const hasToss = !!(st.toss || CURRENT_DOC?.tossWinner);
  const hasXI = !!(st.playingXI && st.playingXI[CURRENT_DOC.a]?.length===11 && st.playingXI[CURRENT_DOC.b]?.length===11);
  const inn = currentInnings(CURRENT_DOC);
  const of = inn?.onField || {};
  const hasOpening = !!(of.striker && of.nonStriker && of.bowler);
  if(!hasToss) return alert("Pehele Toss set karo.");
  if(!hasXI) return alert("Pehele Playing XI (11-11) select karo.");
  if(!hasOpening) return alert("Pehele Opening setup (2 openers + opening bowler) save karo.");
  await setMatchStatus(FB, matchId, "LIVE");
});

$("btnEnd")?.addEventListener("click", async ()=>{
  try{
    // Smart end: if match is tied -> keep LIVE and enable Super Over (multi-device)
    const mRef = matchRef(FB, matchId);
    const snap = await FB._f.getDoc(mRef);
    if(!snap.exists()) return;
    const doc = snap.data() || {};
    const st = doc.state || {};
    const i0 = st?.innings?.[0] || {};
    const i1 = st?.innings?.[1] || {};
    const r0 = Number(i0.runs||0);
    const r1 = Number(i1.runs||0);

    // If tie, do NOT mark completed. Keep LIVE and show Super Over CTA.
    if(st?.inningsIndex === 1 && r0 === r1){
      const patch = {
        status: "LIVE",
        // keep match doc status LIVE for Home/Live viewers
        state: {
          ...st,
          status: "LIVE",
          rules: { ...(st.rules||{}), superOverOnTie: true },
          superOverOvers: Number(st.superOverOvers||1),
          superOverRound: Number(st.superOverRound||1),
          result: { tie:true, superOver:true, text: "Match tied • Super Over pending" }
        }
      };
      await FB._f.updateDoc(mRef, patch);
      alert("Match tied ✅ Super Over pending. Start Super Over to decide winner.");
      return;
    }

    // Normal completion
    await setMatchStatus(FB, matchId, "COMPLETED");
    try{
      const awards = await finalizeMatchAndComputeAwards(FB, matchId);
      showAwardsPopup(awards);
      // Switch to final result view (hide scorer UI)
      showFinalResultScreen(CURRENT_DOC || doc || {}, awards);
}catch(e){
      console.warn("Awards compute failed", e);
    }
  }catch(e){
    console.error(e);
  }
});
$("btnReset")?.addEventListener("click", async ()=>{
  if(!confirm("Reset match? (All balls delete)")) return;
  await resetMatch(FB, matchId);
  alert("Reset done ✅");
});

$("btnSuperOver")?.addEventListener("click", async ()=>{
  try{
    const mRef = matchRef(FB, matchId);
    const snap = await FB._f.getDoc(mRef);
    if(!snap.exists()) return;
    const doc = snap.data() || {};
    const st = doc.state || {};
    const i0 = st?.innings?.[0] || {};
    const i1 = st?.innings?.[1] || {};

    // Create empty innings (same schema as scoring-core)
    const makeEmptyInnings = (batting, bowling)=>({
      batting, bowling,
      runs:0, wkts:0, balls:0, ballsTotal:0, overs:"0.0",
      extras:{ wd:0, nb:0, b:0, lb:0 },
      batters:{},
      bowlers:{},
      onField:{ striker:"", nonStriker:"", bowler:"", freeHit:false, needNewBowler:false, needNextBatter:false },
      ballByBall:[]
    });

    const round = Number(st.superOverRound||1);
    const base = 2 + (round-1)*2;

    // Same team mapping as scoring-core uses on tie:
    // SO1: batting = i0.bowling (chasing team), bowling = i0.batting
    // SO2: batting = i0.batting, bowling = i0.bowling
    const so1 = makeEmptyInnings(i0.bowling || "", i0.batting || "");
    const so2 = makeEmptyInnings(i0.batting || "", i0.bowling || "");

    const innings = Array.isArray(st.innings) ? st.innings.slice() : [];
    innings[base] = so1;
    innings[base+1] = so2;

    await FB._f.updateDoc(mRef, {
      status: "LIVE",
      state: {
        ...st,
        status:"LIVE",
        innings,
        inningsIndex: base,
        rules: { ...(st.rules||{}), superOverOnTie:true },
        superOverOvers: Number(st.superOverOvers||1),
        superOverRound: round,
        result: { superOver:true, tie:true, text: `Super Over ${round} LIVE` }
      }
    });
  }catch(e){
    console.error(e);
  }
});

$("undoBall")?.addEventListener("click", ()=>{
  try{ localStorage.removeItem(`resultPopupShown_${matchId}`); }catch(_){ }
  try{ localStorage.removeItem(`resultModeClosed_${matchId}`); }catch(_){ }
  undoBall(FB, matchId);
});

document.querySelectorAll("[data-run]").forEach(btn=>{
  btn.addEventListener("click", async ()=>{
    const names = requireNames();
    if(!names) return;
    const runs = Number(btn.getAttribute("data-run")||0);
    await safeAddBall({ type:"RUN", runs, batter:names.batter, nonStriker:names.nonStriker, bowler:names.bowler });
  });
});

document.querySelectorAll("[data-extra]").forEach(btn=>{
  btn.addEventListener("click", async ()=>{
    const names = requireNames();
    if(!names) return;
    const x = btn.getAttribute("data-extra");
    if(x==="wd"){
      const total = Math.max(1, Number(prompt("Wide total runs? (min 1)", "1") || 1));
      await safeAddBall({ type:"WD", runs:total, batter:names.batter, nonStriker:names.nonStriker, bowler:names.bowler });
    }
    if(x==="nb"){
      const total = Math.max(1, Number(prompt("No-ball total runs? (min 1)\nExample: NB+4 = 5", "1") || 1));
      let batRuns = 0;
      if(total>1 && confirm("NB par bat se runs hue the? (OK=yes / Cancel=no)")){
        batRuns = Math.max(0, Math.min(total-1, Number(prompt("Bat runs on NB? (0-"+(total-1)+")", String(total-1)) || (total-1))));
      }
      await safeAddBall({ type:"NB", runs:total, batRuns, batter:names.batter, nonStriker:names.nonStriker, bowler:names.bowler });
    }
    if(x==="bye"){
      const r = Math.max(0, Number(prompt("Bye runs?", "1") || 1));
      await safeAddBall({ type:"BYE", runs:r, batter:names.batter, nonStriker:names.nonStriker, bowler:names.bowler });
    }
    if(x==="lb"){
      const r = Math.max(0, Number(prompt("Leg-bye runs?", "1") || 1));
      await safeAddBall({ type:"LB", runs:r, batter:names.batter, nonStriker:names.nonStriker, bowler:names.bowler });
    }
  });
});

document.querySelectorAll("[data-wicket]").forEach(btn=>{
  btn.addEventListener("click", ()=> openWicketModal(CURRENT_DOC));
});

// -----------------------------
// Auth
// -----------------------------
watchAuth(FB, (user)=>{
  if(!user){
    showState("Login required. Admin page se login karke aao.", false);
  }else{
    showState(`Logged in: ${user.email}`, true);
  }
});

// -----------------------------
// Render
// -----------------------------
function render(doc){
  CURRENT_DOC = doc;
  ensureWizard();
  window.__MATCH__ = doc;// exposed for UI debug

  if(!doc){
    showState("Match not found.", false);
    return;
  }

  if(!TOURNAMENT){
    loadTournament(FB).then(t=>{
      TOURNAMENT = t;
      SQUADS = t?.squads || {};
    }).catch(()=>{});
  }

  $("sTitle").textContent = `Scorer • Match ${doc.matchId || matchId}`;
  $("sMeta").textContent = `${doc.a} vs ${doc.b} • Group ${doc.group||"-"} • Time ${doc.time||"-"} • Status ${doc.status||"UPCOMING"}`;

  // ✅ Auto completion popup (Result + quick links)
  if(LAST_STATUS && LAST_STATUS !== "COMPLETED" && doc.status === "COMPLETED"){
    const key = `resultShown:${matchId}:${doc.updatedAt?.seconds||""}`;
    if(!localStorage.getItem(key)){
      showResultPopup(doc, doc.awards);
      localStorage.setItem(key, "1");
    }
  }
  LAST_STATUS = doc.status;

  // ✅ If match is completed, hide scorer and show final result screen
  if(doc.status === 'COMPLETED'){
    showFinalResultScreen(doc, doc.awards);
  }else{
    exitFinalResultScreen();
  }

  // ✅ Result line under match meta (always visible when completed)
  const resLine = ensureResultLine();
  if(resLine){
    const r = computeMatchResult(doc);
    resLine.textContent = (doc.status === "COMPLETED" && r) ? (`RESULT: ${r.text}`) : "";
  }

  // ✅ Super Over CTA (only when match tied and still LIVE)
  const soBtn = $("btnSuperOver");
  if(soBtn){
    const st0 = doc?.state || {};
    const r0 = st0?.result || {};
    const isTieLive = (doc.status === "LIVE") && (r0.tie || (String(r0.text||"").toLowerCase().includes("tied")));
    soBtn.style.display = (isTieLive && (st0?.rules?.superOverOnTie ?? true)) ? "" : "none";
    if(isTieLive){
      const round = Number(st0.superOverRound||1);
      soBtn.textContent = `Start Super Over ${round}`;
    }
  }

  mountTossCard();
  updateTossUI(doc);

  mountPlayingXICard();
  updateXIUI(doc);

  mountInningsBreakCard();
  updateInningsBreakUI(doc);

  mountOpeningCard();
  updateOpeningUI(doc);

  if(WIZARD) WIZARD.sync(doc);

  ensureDropdowns(doc);

  // Cricbuzz-style live chip for scorer
  renderScorerLiveChip(doc);
  renderFreeHitBadge(doc);
  maybeShowInningsBreak(doc);
  renderPhase1Insights(doc);

  const inn = currentInnings(doc);
  const of = inn?.onField;
  if(of){
    if(of.striker) $("batter").value = of.striker;
    if(of.nonStriker) $("nonStriker").value = of.nonStriker;

    if(of.needNewBowler){
      $("bowler").value = "";
      showState("Over complete. New bowler select karo.", false);
      openBowlerModal(doc);
    }else if(of.bowler){
      $("bowler").value = of.bowler;
    }

    if(of.needNextBatter){
      showState("Wicket hua hai. Wicket button se next batsman select karo.", false);
    }
  }

  const preview = $("preview");
  if(preview){
    const st = doc.state || {};
    const summary = doc.summary || st.summary || {};
    const r = computeMatchResult(doc);
    const resHTML = (doc.status==="COMPLETED" && r) ? `<div class="muted small" style="margin:6px 0 8px"><b>RESULT:</b> ${esc(r.text)}</div>` : "";
    preview.innerHTML =
      resHTML
      + renderScoreLine({ matchId: doc.matchId, a: doc.a, b: doc.b, group: doc.group, time: doc.time, status: doc.status, summary }, st)
      + renderCommentary(st, 8);
  }
}

watchMatch(FB, matchId, render);


// ===== Phase-1 Scorer Insights (READ-ONLY, UI only) =====
function p1_isLegalBall(ev){
  // best-effort: treat wides/no-balls as NOT legal
  if(ev==null) return true;
  const typeRaw = (ev.type ?? ev.t ?? ev.k ?? ev.kind ?? ev.event ?? ev.eventType ?? ev.code ?? ev.extraType ?? ev.extra ?? '').toString().toUpperCase();
  const delRaw  = (ev.delivery ?? ev.del ?? ev.d ?? ev.ballType ?? '').toString().toUpperCase();
  const t = (typeRaw || delRaw);
  if(t.includes('WD') || t.includes('WIDE') || delRaw==='WD') return false;
  if(t.includes('NB') || t.includes('NO')   || delRaw==='NB') return false;
  // Some schemas mark legal explicitly
  if(ev.legal === false || ev.isLegal === false) return false;
  return true;
}
function p1_label(ev){
  if(ev==null) return '';
  if(typeof ev === 'string' || typeof ev === 'number') return String(ev);

  // Normalize common core schema (scoring-core.js ballByBall)
  const typeRaw = (ev.type ?? ev.t ?? ev.k ?? ev.kind ?? ev.event ?? ev.eventType ?? '').toString().toUpperCase();
  const delRaw  = (ev.delivery ?? ev.del ?? ev.d ?? ev.ballType ?? '').toString().toUpperCase();

  // ✅ Wicket detection (support v2 schema + compact schemas)
  // scoring-core: { type:"WICKET", wicket:{...} } only when wicketApplied=true
  if(typeRaw === 'WICKET' || typeRaw === 'W' || ev.kind==='W' || ev.wicket || ev.isWicket || ev.w === true) return 'W';
  if(ev.wicketApplied === true || (ev.wicket && typeof ev.wicket === 'object')) return 'W';

  // ✅ Extras first (wide/no-ball often stored in delivery/type)
  if(typeRaw === 'WD' || delRaw === 'WD' || typeRaw.includes('WIDE')) return 'WD';
  if(typeRaw === 'NB' || delRaw === 'NB' || typeRaw.includes('NO')) return 'NB';

  // ✅ Byes / Leg byes (keep label as B/LB; chips remain readable)
  if(typeRaw === 'BYE' || typeRaw === 'B') return 'B';
  if(typeRaw === 'LB' || typeRaw === 'LEG BYE' || typeRaw === 'LEGBYE') return 'LB';

  // ✅ Runs: support BOTH older schemas and scoring-core v2 schema
  // scoring-core: runsTotal (total runs on that ball), runsInput (user input runs)
  const r = (
    ev.runsInput ?? ev.runsTotal ??
    ev.batRuns ?? ev.batsmanRuns ?? ev.br ?? ev.rBat ?? ev.runsBat ??
    ev.totalRuns ?? ev.runs ?? ev.run ?? ev.r ?? ev.value ?? ev.val ??
    // nested forms (some older apps)
    ev?.runs?.total ?? ev?.runs?.batter ?? ev?.runs?.bat ?? ev?.runs?.offBat
  );

  if(typeof r === 'number') return String(r);
  if(typeof r === 'string' && r.trim()!=='' && !Number.isNaN(Number(r))) return String(Number(r));

  // ✅ FINAL fallback (never return empty for legal dot ball)
  const fb = ev.label || ev.outcome || ev.text;
  if(fb === '' || fb == null){
    // If this is a legal ball and we couldn't derive runs, show 0 (so chip doesn't become •)
    if(ev.legal === true) return '0';
    return '';
  }
  return String(fb);
}
function renderPhase1Insights(doc){
  try{
    const wrap = document.getElementById('p1Insights');
    if(!wrap) return;

    const st = doc?.state || {};
    const idx = Number(st.inningsIndex || 0);
    const inn = st?.innings?.[idx];
    if(!inn){ wrap.style.display='none'; return; }

    // Compute chase info for innings 2+
    
const banner = document.getElementById('p1MatchSituation');
if(banner){
  const inSuper = idx >= 2;
  if(inSuper){
    // Super Over: show a dedicated situation line (no normal innings chase math)
    const soOvers = Number(st.superOverOvers || 1);
    const soBallsTotal = Math.max(0, soOvers * 6);

    const base = (idx % 2 === 0) ? idx : (idx - 1); // SO1 is even index, SO2 is odd index
    const so1 = st?.innings?.[base] || {};
    const so2 = st?.innings?.[base+1] || {};

    const round = Number(st.superOverRound || 1);

    if(idx === base){
      // Super Over innings-1: setting target
      banner.textContent = `Super Over ${round} • Set target`;
      banner.style.display = '';
    }else{
      // Super Over innings-2: chasing
      const target = Number(so1.runs||0) + 1;
      const ballsBowled = Number(so2.balls||0);
      const ballsLeft = Math.max(0, soBallsTotal - ballsBowled);
      const need = Math.max(0, target - Number(so2.runs||0));
      const req = ballsLeft>0 ? (need/(ballsLeft/6)).toFixed(2) : '0.00';
      banner.textContent = `Super Over ${round} • Need ${need} in ${ballsLeft} balls • Req RR ${req}`;
      banner.style.display = '';
    }
  }else if(idx>=1 && st?.innings?.[0]){
    // Regular chase (innings 2)
    const target = Number(st.innings[0].runs||0) + 1;
    const totalBalls = Number(st.oversPerInnings||10) * 6;
    const ballsBowled = Number(inn.balls||0); // assumed legal balls
    const ballsLeft = Math.max(0, totalBalls - ballsBowled);
    const need = Math.max(0, target - Number(inn.runs||0));
    const crr = ballsBowled>0 ? (Number(inn.runs||0)/(ballsBowled/6)).toFixed(2) : '0.00';
    const req = ballsLeft>0 ? (need/(ballsLeft/6)).toFixed(2) : '0.00';
    banner.textContent = `Need ${need} in ${ballsLeft} balls • CRR ${crr} • Req RR ${req}`;
    banner.style.display = '';
  }else{
    banner.style.display = 'none';
  }
}

    // Current over strip from ballByBall (best-effort)
    const bbb = Array.isArray(inn.ballByBall) ? inn.ballByBall : [];
    const ballsBowled = Number(inn.balls||0);
    const ballsInOver = (ballsBowled % 6);
    const legalNeeded = ballsInOver===0 ? 6 : ballsInOver;
    let events = [];
    // walk backwards and collect last legalNeeded legal balls, but include illegal balls in between in same over
    let legalCount = 0;
    for(let i=bbb.length-1;i>=0;i--){
      const ev = bbb[i];
      events.unshift(ev);
      if(p1_isLegalBall(ev)) legalCount++;
      if(legalCount>=legalNeeded) break;
    }
    const strip = document.getElementById('p1OverStrip');
    const sum = document.getElementById('p1OverSummary');
    if(strip){
      if(events.length){
        strip.innerHTML = `<span class="p1OverT">This Over</span>` + events.map(ev=>{
          const lab = p1_label(ev);
          const cls = (lab==='W')?'w':(lab==='WD'?'wd':(lab==='NB'?'nb':'r'));
          return `<span class="p1Chip ${cls}">${lab||'•'}</span>`;
        }).join('');
        strip.style.display='';
      }else{
        strip.style.display='none';
      }
    }

    // This over summary
    if(sum){
      if(events.length){
        let runs=0, wk=0, wd=0, nb=0;
        events.forEach(ev=>{
          const lab = p1_label(ev);
          if(lab==='W') wk++;
          if(lab==='WD') wd++;
          if(lab==='NB') nb++;
          const r = (typeof ev==='object') ? (
            ev.totalRuns ??
            ev.runsTotal ??
            ev.runsInput ??
            ev.runs ??
            ev.batRuns ??
            ev.run ??
            ev.r ??
            0
          ) : (Number(lab)||0);
          // for WD/NB, totalRuns often includes extra; keep best-effort
          if(typeof r === 'number' && !Number.isNaN(r)) runs += r;
          else if(!['W','WD','NB'].includes(lab) && !Number.isNaN(Number(lab))) runs += Number(lab);
        });
        sum.textContent = `This over: ${runs} runs • ${wk} wkts • WD ${wd} • NB ${nb}`;
        sum.style.display='';
      }else sum.style.display='none';
    }

    // Partnership: sum of current two batters only (best-effort)
    const pPart = document.getElementById('p1Partnership');
    if(pPart){
      const of = inn.onField || {};
      const s = of.striker, n = of.nonStriker;
      if(s && n && inn.batters){
        const sb = inn.batters[s] || {};
        const nbm = inn.batters[n] || {};
        const pr = Number(sb.r||0)+Number(nbm.r||0);
        const pb = Number(sb.b||0)+Number(nbm.b||0);
        pPart.innerHTML = `<div class="p1CardT">Partnership</div><div class="p1CardV">${pr} <span class="p1Dim">(${pb} balls)</span></div>`;
        pPart.style.display='';
      }else{
        pPart.style.display='none';
      }
    }

    // Bowler mini-card
    const pBow = document.getElementById('p1Bowler');
    if(pBow){
      const of = inn.onField || {};
      const bowName = of.bowler;
      if(bowName && inn.bowlers){
        const bo = inn.bowlers[bowName] || {};
        const ob = Number(bo.oBalls||0);
        const o = `${Math.floor(ob/6)}.${ob%6}`;
        const r = Number(bo.r||0), w = Number(bo.w||0);
        const econ = ob>0 ? (r/(ob/6)).toFixed(2) : '0.00';
        pBow.innerHTML = `<div class="p1CardT">Bowler</div><div class="p1CardV">${bowName}</div><div class="p1Sub">O ${o} • R ${r} • W ${w} • Econ ${econ}</div>`;
        pBow.style.display='';
      }else pBow.style.display='none';
    }

    // Hint: over-end prompt
    const hint = document.getElementById('p1Hint');
    if(hint){
      if(ballsInOver===0 && ballsBowled>0){
        hint.textContent = 'Over completed. Select next bowler.';
        hint.style.display='';
      }else{
        hint.style.display='none';
      }
    }

    wrap.style.display = '';
  }catch(e){
    // fail silently
  }
}
// ===== /Phase-1 =====