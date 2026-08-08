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
