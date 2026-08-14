/* Third harness: simulate a full block end-to-end through the rules engine —
   week advancement, phase transitions, the deload, and load progression. */
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { vendor, launchOpts } = require("./helpers");

const ROOT = path.join(__dirname, ".."), PORT = 8902;
const MIME = {".html":"text/html",".js":"application/javascript",".json":"application/json"};
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split("?")[0]); if(p==="/") p="/index.html";
  const f = path.join(ROOT,p);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{"Content-Type":MIME[path.extname(f)]||"text/plain"});
  res.end(fs.readFileSync(f));
});
let failures=0;
const check=(n,ok,d)=>{ console.log(`${ok?"  PASS":"  FAIL"}  ${n}${d&&!ok?` — ${d}`:""}`); if(!ok) failures++; };

const VENDOR={"react.production.min.js":"react.js","react-dom.production.min.js":"react-dom.js","babel.min.js":"babel.js"};

(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const browser = await chromium.launch({...launchOpts()});
  const ctx = await browser.newContext({serviceWorkers:"block"});
  const page = await ctx.newPage();
  const errors=[]; page.on("pageerror",e=>errors.push(e.message));
  await ctx.route("**/unpkg.com/**", r=>{
    const f=Object.entries(VENDOR).find(([n])=>r.request().url().includes(n));
    return f?r.fulfill({status:200,contentType:"application/javascript",body:fs.readFileSync(vendor(f[1]))}):r.abort();
  });
  await ctx.route("**/fonts.googleapis.com/**", r=>r.fulfill({status:200,contentType:"text/css",body:""}));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`,{waitUntil:"networkidle"});
  await page.waitForTimeout(2000);

  console.log("\n── FULL BLOCK SIMULATION (8 weeks, 3 days/wk) ───");
  const sim = await page.evaluate(()=>{
    // Build a state as onboarding would, then run every session of the block.
    let st = defaultState();
    st.onboarded = true;
    st.goal = {type:"build_muscle", startValue:"80", targetValue:"84", targetDate:"2026-12-01"};
    st.profile = {...st.profile, daysPerWeek:3, sessionMinutes:45, experience:"beginner"};
    st.block = buildBlockRules(st);

    const timeline = [], legPress = [];
    let guard = 0;
    while(guard++ < 200){
      const prog = blockProgress(st);
      if(prog.complete) break;
      const sess = buildSessionRules(st, {sleep:4,energy:4,soreness:2,stress:2});
      if(!sess) return {error:"no session generated"};

      timeline.push({week:prog.week, phase:prog.phase.name, day:sess.dayName,
        exercises:sess.exercises.length, sets:sess.exercises[0].sets,
        reps:sess.exercises[0].targetReps});

      const lp = sess.exercises.find(e=>e.exId==="leg_press");
      if(lp) legPress.push({week:prog.week, phase:prog.phase.name, weight:lp.weight});

      // Log every set at the top of the target range, felt "solid" — the
      // textbook case that should drive load up every time.
      sess.exercises.forEach(e=>{
        const reps = e.repRange ? e.repRange[1] : e.targetReps;
        st.weights[e.exId] = {weight:e.weight, lastAvgReps:reps, lastTargetReps:e.targetReps,
          lastEffort:"good", inc:e.inc, updated:sess.date};
        st.exerciseHistory[e.exId] = [...(st.exerciseHistory[e.exId]||[]),
          {date:sess.date, weight:e.weight, avgReps:reps, targetReps:e.targetReps,
           setsLogged:e.sets, totalSets:e.sets, dayName:sess.dayName}];
      });
      st.sessions = [{...sess, blockId:st.block.id, exercises:sess.exercises.map(e=>({...e,
        log:Array(e.sets).fill({reps:e.targetReps, effort:"good", weight:e.weight})}))}, ...st.sessions];
    }
    return {
      timeline, legPress,
      totalSessions: st.sessions.length,
      totalWeeks: st.block.totalWeeks,
      phases: st.block.phases.map(p=>`${p.name}:${p.weeks}`),
      complete: blockProgress(st).complete,
      review: weeklyReviewRules(st),
      finalWeights: Object.fromEntries(Object.entries(st.weights).map(([k,v])=>[k,v.weight])),
    };
  });

  if(sim.error) { check("simulation ran", false, sim.error); }
  else {
    check("block has phases", sim.phases.length>=3, JSON.stringify(sim.phases));
    check("block completes", sim.complete===true);
    check("session count = weeks × days", sim.totalSessions === sim.totalWeeks*3,
      `${sim.totalSessions} sessions over ${sim.totalWeeks} weeks`);
    check("every session produced exercises", sim.timeline.every(t=>t.exercises>=3),
      JSON.stringify(sim.timeline.filter(t=>t.exercises<3).slice(0,3)));

    const weeks = [...new Set(sim.timeline.map(t=>t.week))];
    check("weeks advance 1..N", weeks[0]===1 && weeks[weeks.length-1]===sim.totalWeeks,
      JSON.stringify(weeks));

    const phaseOrder = [...new Set(sim.timeline.map(t=>t.phase))];
    check("phases progress in order", phaseOrder.length>=3, JSON.stringify(phaseOrder));
    check("block ends on a deload", /deload/i.test(phaseOrder[phaseOrder.length-1]), phaseOrder.join(" → "));

    const days = [...new Set(sim.timeline.slice(0,3).map(t=>t.day))];
    check("split rotates across the week", days.length===3, JSON.stringify(days));

    // Leg press should climb through the block, then drop hard in the deload.
    const working = sim.legPress.filter(x=>!/deload/i.test(x.phase));
    const deload  = sim.legPress.filter(x=>/deload/i.test(x.phase));
    check("load climbs across the block",
      working.length>1 && working[working.length-1].weight > working[0].weight,
      JSON.stringify(sim.legPress.slice(0,10)));
    check("deload drops the load",
      deload.length===0 || deload[0].weight < working[working.length-1].weight*0.8,
      JSON.stringify({lastWorking:working[working.length-1], firstDeload:deload[0]}));

    console.log("\n     leg press by week:",
      sim.legPress.map(x=>`w${x.week}:${x.weight}kg`).join("  "));
    console.log("     phases:", phaseOrder.join(" → "));

    check("weekly review generated", !!sim.review?.headline, JSON.stringify(sim.review).slice(0,120));
  }

  console.log("\n── OPTIONAL EXTRA SESSION ───────────────────────");
  const bonus = await page.evaluate(()=>{
    const st = defaultState();
    st.onboarded = true;
    st.goal = {type:"build_muscle"};
    st.profile = {...st.profile, daysPerWeek:3, sessionMinutes:45};
    st.block = buildBlockRules(st);

    const first = buildSessionRules(st, null);
    st.sessions = [{...first, finishedAt:new Date().toISOString()}, ...st.sessions];
    const before = blockProgress(st);
    const expectedExtraDay = (SPLITS[before.dpw]||SPLITS[3])[before.dayIdx].name;
    const extra = buildSessionRules(st, null, {bonus:true});
    st.sessions = [{...extra, finishedAt:new Date().toISOString()}, ...st.sessions];
    const after = blockProgress(st);
    const next = buildSessionRules(st, null);
    const review = weeklyReviewRules(st);
    return {
      marked:extra.bonus,
      name:extra.dayName,
      expectedExtraDay,
      aligned:extra.phaseName===before.phase.name && extra.exercises.every(e=>e.rpe===before.phase.rpe),
      before:{done:before.done,dayIdx:before.dayIdx,phase:before.phase.name},
      after:{done:after.done,dayIdx:after.dayIdx,bonusDone:after.bonusDone},
      first:first.dayName,
      next:next.dayName,
      review:{sessions:review.sessions,bonusSessions:review.bonusSessions},
    };
  });
  check("extra session is clearly marked", bonus.marked===true, JSON.stringify(bonus));
  check("extra session uses the next day in the plan", bonus.name===bonus.expectedExtraDay,
    `${bonus.name} vs ${bonus.expectedExtraDay}`);
  check("extra session follows the current phase targets", bonus.aligned===true, JSON.stringify(bonus));
  check("finishing an extra session advances block progress normally",
    bonus.after.done===bonus.before.done+1 && bonus.before.dayIdx!==bonus.after.dayIdx,
    JSON.stringify({before:bonus.before,after:bonus.after}));
  check("extra session has its own progress count", bonus.after.bonusDone===1, JSON.stringify(bonus.after));
  check("the plan rotation continues after the extra session", bonus.first!==bonus.next,
    `${bonus.first} → bonus → ${bonus.next}`);
  check("weekly attendance keeps extras separate",
    bonus.review.sessions===1 && bonus.review.bonusSessions===1, JSON.stringify(bonus.review));

  console.log("\n── CHANGING WEEKLY FREQUENCY KEEPS THE BLOCK ────");
  const cadence = await page.evaluate(()=>{
    const st = defaultState();
    st.onboarded=true; st.goal={type:"build_muscle"};
    st.profile={...st.profile,daysPerWeek:3};
    st.block=buildBlockRules(st);
    const originalId=st.block.id;
    for(let i=0;i<4;i++){
      const sess=buildSessionRules(st,null);
      st.sessions=[{...sess,finishedAt:new Date().toISOString()},...st.sessions];
    }
    const before=blockProgress(st);
    const changed=changeTrainingDays(st,4);
    const after=blockProgress(changed);
    const next=buildSessionRules(changed,null);
    return {
      originalId,changedId:changed.block.id,
      before:{week:before.week,phase:before.phase.name,done:before.done},
      after:{week:after.week,phase:after.phase.name,done:after.done,dpw:after.dpw,dayIdx:after.dayIdx},
      next:next.dayName,
      split:(SPLITS[4]||[]).map(d=>d.name),
    };
  });
  check("changing days does not replace the block", cadence.changedId===cadence.originalId, JSON.stringify(cadence));
  check("changing days preserves week and phase",
    cadence.after.week===cadence.before.week && cadence.after.phase===cadence.before.phase,
    JSON.stringify(cadence));
  check("new frequency and split apply to the next session",
    cadence.after.dpw===4 && cadence.split.includes(cadence.next), JSON.stringify(cadence));

  console.log("\n── ONE-WEEK TARGETS & LOG REASSIGNMENT ────────");
  const weekControl = await page.evaluate(()=>{
    let st=defaultState();
    st.onboarded=true; st.goal={type:"build_muscle"};
    st.profile={...st.profile,daysPerWeek:4};
    st.block=buildBlockRules(st);
    st=setPlanWeekTarget(st,1,5);
    for(let i=0;i<4;i++){
      const sess=buildSessionRules(st,null);
      st.sessions=[{...sess,finishedAt:new Date().toISOString()},...st.sessions];
    }
    const afterFour=blockProgress(st);
    const fifth=buildSessionRules(st,null);
    st.sessions=[{...fifth,finishedAt:new Date().toISOString()},...st.sessions];
    const afterFive=blockProgress(st);
    st.sessions=st.sessions.map((s,i)=>i===0?{...s,planWeek:2}:s);
    const afterMove=blockProgress(st);
    return {
      customTarget:afterFour.dpw,afterFour:{week:afterFour.week,dayIdx:afterFour.dayIdx},
      afterFive:{week:afterFive.week,dayIdx:afterFive.dayIdx},
      afterMove:{week:afterMove.week,dayIdx:afterMove.dayIdx},
      movedWeek:planWeekForSession(st.sessions[0]),usual:st.profile.daysPerWeek,
    };
  });
  check("a five-session override applies only to the selected week",
    weekControl.customTarget===5 && weekControl.usual===4,JSON.stringify(weekControl));
  check("the custom week advances after its fifth session",
    weekControl.afterFour.week===1 && weekControl.afterFour.dayIdx===4 && weekControl.afterFive.week===2,
    JSON.stringify(weekControl));
  check("moving a log to another week recalculates plan progress",
    weekControl.movedWeek===2 && weekControl.afterMove.week===1 && weekControl.afterMove.dayIdx===4,
    JSON.stringify(weekControl));

  const weekFailsafe=await page.evaluate(()=>{
    let st=defaultState(); st.onboarded=true; st.goal={type:"build_muscle"}; st.block=buildBlockRules(st);
    const automatic=blockProgress(st).week;
    st=setCurrentPlanWeek(st,2);
    const manual=blockProgress(st);
    const floor=st.block.weekFloor;
    const generated=buildSessionRules(st,null);
    st.sessions=[{...generated,finishedAt:new Date().toISOString()},...st.sessions];
    const afterOne=blockProgress(st);
    st=clearCurrentPlanWeek(st);
    return {automatic,manual:{week:manual.week,floor},generatedWeek:generated.week,
      afterOne:afterOne.week,cleared:blockProgress(st).week};
  });
  check("the manual current-week failsafe can skip an incomplete earlier week",
    weekFailsafe.automatic===1 && weekFailsafe.manual.week===2 && weekFailsafe.manual.floor===2 && weekFailsafe.generatedWeek===2,
    JSON.stringify(weekFailsafe));
  check("returning to automatic never edits or fabricates session history",
    weekFailsafe.cleared===1,JSON.stringify(weekFailsafe));

  console.log("\n── PLATE-LOADED MACHINE MATH ────────────────");
  const machineLoads=await page.evaluate(()=>{
    const st=defaultState();
    const incline=platePrescription(47.2,plateLoadConfig(st,"21"));
    const leg=platePrescription(93,plateLoadConfig(st,"35"));
    const unknown=platePrescription(40,plateLoadConfig(st,"36"));
    return {incline,leg,unknown,stations:Object.keys(PLATE_LOADED_DEFAULTS).length,
      catalogue:SEED_STATIONS.length};
  });
  check("the complete 50-station floor plan plus sandbags is seeded",machineLoads.catalogue===51,String(machineLoads.catalogue));
  check("incline press includes 3.6kg per arm and equal 20kg plates",
    machineLoads.incline.total===47.2 && machineLoads.incline.baseTotal===7.2 && machineLoads.incline.perSide===20,
    JSON.stringify(machineLoads.incline));
  check("linear leg press includes its 53kg carriage and 20kg per side",
    machineLoads.leg.total===93 && machineLoads.leg.baseTotal===53 && machineLoads.leg.perSide===20,
    JSON.stringify(machineLoads.leg));
  check("an unpublished starting resistance is never guessed",machineLoads.unknown===null,JSON.stringify(machineLoads));

  console.log("\n── RAMP SETS & BUSY-EQUIPMENT SWAPS ────────────");
  const workingSets = await page.evaluate(()=>{
    const ramp=performanceSummary([
      {weight:10,reps:10,effort:"good"},
      {weight:15,reps:10,effort:"good"},
      {weight:20,reps:10,effort:"good"},
    ],[8,12]);
    const st=defaultState(); st.goal={type:"build_muscle"}; st.block=buildBlockRules(st);
    const session=buildSessionRules(st,null);
    const current=session.exercises.find(e=>exerciseSwapOptions(e,st,session).length) || session.exercises[0];
    const swaps=exerciseSwapOptions(current,st,session);
    return {ramp, current:{id:current.exId,pattern:current.pattern,stations:current.stations},
      swaps:swaps.map(ex=>({id:ex.id,pattern:ex.pattern,stations:stationsForExercise(ex,st)}))};
  });
  check("ramp-up sets keep the heaviest productive working load",
    workingSets.ramp.weight===20 && workingSets.ramp.avgReps===10 && workingSets.ramp.sets===1,
    JSON.stringify(workingSets.ramp));
  check("busy-equipment swap offers no more than two alternatives",
    workingSets.swaps.length<=2, JSON.stringify(workingSets.swaps));
  check("every swap preserves the movement pattern and avoids duplicates",
    workingSets.swaps.every(x=>x.pattern===workingSets.current.pattern && x.id!==workingSets.current.id),
    JSON.stringify(workingSets));

  console.log("\n-- MULTI-JUNGLE & FUNCTIONAL SANDBAGS -----------");
  const functional = await page.evaluate(()=>{
    const withOnly = enabled=>{
      const st=defaultState();
      st.equipment={enabled,custom:[]};
      return {state:st,pool:availableExercises(st)};
    };
    const cable=withOnly(["17"]), bags=withOnly(["SB"]);
    const old=migrate({v:2,equipmentCatalogueVersion:1,equipment:{enabled:["29"],custom:[]}});
    const optedOut=migrate({v:2,equipmentCatalogueVersion:2,equipment:{enabled:["29"],custom:[]}});
    return {
      cableIds:cable.pool.map(e=>e.id),
      cableStations:cable.pool.map(e=>({id:e.id,stations:stationsForExercise(e,cable.state)})),
      bagIds:bags.pool.map(e=>e.id),
      bagPatterns:[...new Set(bags.pool.map(e=>e.pattern))],
      oldGetsBags:old.equipment.enabled.includes("SB"),
      optOutSticks:!optedOut.equipment.enabled.includes("SB"),
    };
  });
  check("Multi-Jungle works without a second cable station",
    ["lat_pulldown","cable_row","tricep_pushdown"].every(id=>functional.cableIds.includes(id)),
    JSON.stringify(functional.cableIds));
  check("a cable exercise stores the station actually available",
    functional.cableStations.every(e=>e.stations.length===1 && e.stations[0]==="17"),
    JSON.stringify(functional.cableStations));
  check("adjustable-pulley movements are available",
    ["single_cable_fly","face_pull","cable_lateral_raise","cable_curl","pallof_press"]
      .every(id=>functional.cableIds.includes(id)), JSON.stringify(functional.cableIds));
  check("sandbags add five trackable exercises", functional.bagIds.length===5,
    JSON.stringify(functional.bagIds));
  check("sandbags cover legs, hinge, press and core",
    ["squat","hinge","push_v","core"].every(p=>functional.bagPatterns.includes(p)),
    JSON.stringify(functional.bagPatterns));
  check("existing installs receive the known sandbag station once",
    functional.oldGetsBags && functional.optOutSticks, JSON.stringify(functional));

  console.log("\n── EQUIPMENT CONSTRAINTS ────────────────────────");
  const eq = await page.evaluate(()=>{
    let st = defaultState();
    st.goal={type:"build_muscle"}; st.onboarded=true;
    // Only dumbbells and a flat bench available.
    st.equipment = {enabled:["29","26"], custom:[]};
    st.block = buildBlockRules(st);
    const pool = availableExercises(st);
    const sess = buildSessionRules(st, null);
    return { poolIds: pool.map(e=>e.id),
      sessionIds: sess ? sess.exercises.map(e=>e.exId) : [],
      allDumbbell: pool.every(e=>e.stations.every(s=>["29","26"].includes(s))) };
  });
  check("pool respects equipment", eq.allDumbbell, JSON.stringify(eq.poolIds));
  check("no machine exercises leak in", !eq.sessionIds.includes("leg_press"), JSON.stringify(eq.sessionIds));
  check("still builds a session from a bare gym", eq.sessionIds.length>=2, JSON.stringify(eq.sessionIds));

  console.log("\n── INJURY CONSTRAINTS ───────────────────────────");
  const inj = await page.evaluate(()=>{
    let st = defaultState();
    st.goal={type:"build_muscle"}; st.onboarded=true;
    st.limits = {...st.limits, knees:true, shoulders:true};
    st.block = buildBlockRules(st);
    const pool = availableExercises(st);
    const sess = buildSessionRules(st, null);
    return { ids: sess ? sess.exercises.map(e=>e.exId) : [],
      hasKnee: pool.some(e=>e.tags?.includes("knee")),
      hasShoulder: pool.some(e=>e.tags?.includes("shoulder")) };
  });
  check("knee exercises excluded", !inj.hasKnee);
  check("shoulder exercises excluded", !inj.hasShoulder);
  check("still builds a session", inj.ids.length>=3, JSON.stringify(inj.ids));

  console.log("\n── DURATION SHAPING ─────────────────────────────");
  const dur = await page.evaluate(()=>{
    const out={};
    [20,30,45,60,90].forEach(m=>{
      let st=defaultState(); st.goal={type:"build_muscle"}; st.onboarded=true;
      st.profile={...st.profile, sessionMinutes:m};
      st.block=buildBlockRules(st);
      const s=buildSessionRules(st,null);
      out[m]= s ? s.exercises.length : 0;
    });
    return out;
  });
  check("20 min → 3 exercises", dur[20]<=3, JSON.stringify(dur));
  check("45 min → about 5", dur[45]>=4 && dur[45]<=5, JSON.stringify(dur));
  check("90 min → most exercises", dur[90]>=dur[45], JSON.stringify(dur));
  console.log("     exercises by session length:", JSON.stringify(dur));

  check("no uncaught errors", errors.length===0, errors.slice(0,3).join(" | "));
  await browser.close(); server.close();
  console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}\n`);
  process.exit(failures?1:0);
})().catch(e=>{ console.error("HARNESS ERROR:",e.message); server.close(); process.exit(2); });
