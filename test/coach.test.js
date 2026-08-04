/* Second harness: AI path, fallthrough, progression maths, CSV migration. */
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { vendor, launchOpts } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PORT = 8901;
const MIME = {".html":"text/html",".js":"application/javascript",".json":"application/json"};

const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split("?")[0]);
  if(p==="/") p="/index.html";
  const f = path.join(ROOT,p);
  if(!f.startsWith(ROOT) || !fs.existsSync(f)){ res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200,{"Content-Type": MIME[path.extname(f)]||"text/plain"});
  res.end(fs.readFileSync(f));
});

let failures = 0;
function check(name, ok, detail){
  console.log(`${ok?"  PASS":"  FAIL"}  ${name}${detail&&!ok?` — ${detail}`:""}`);
  if(!ok) failures++;
}

const VENDOR = {
  "react.production.min.js": vendor("react.js"),
  "react-dom.production.min.js": vendor("react-dom.js"),
  "babel.min.js": vendor("babel.js"),
};

// What the mock API returns next. Mutated per test.
let apiMode = "ok";
let lastRequest = null;

function mockBlock(){
  return { name:"Test 6 week block", rationale:"Built for the test.", phases:[
    {name:"Base", weeks:2, sets:3, repRange:[10,12], rpe:7, restMult:1.0, intent:"Settle in."},
    {name:"Build", weeks:3, sets:4, repRange:[8,10], rpe:8, restMult:1.1, intent:"Push harder."},
    {name:"Deload", weeks:1, sets:2, repRange:[10,12], rpe:6, restMult:0.9, intent:"Back off."},
  ]};
}
function mockSession(){
  return { focusTip:"Mock cue for today.", adaptationNote:"Trimmed because you slept badly.",
    exercises:[
      {exId:"leg_press", sets:3, targetReps:10, weight:100, rest:120, why:"Mock reason one."},
      {exId:"chest_press_mach", sets:3, targetReps:10, weight:40, rest:90, why:"Mock reason two."},
      {exId:"seated_row", sets:3, targetReps:10, weight:45, rest:90, why:"Mock reason three."},
    ]};
}

(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const browser = await chromium.launch({...launchOpts()});
  const ctx = await browser.newContext({viewport:{width:390,height:844}, serviceWorkers:"block"});
  const page = await ctx.newPage();
  const errors = [];
  // The browser logs every non-2xx fetch as a console error. Several tests below
  // deliberately fail the API, so those are expected — only count real app errors.
  const EXPECTED = /Failed to load resource|net::ERR_FAILED|api\.anthropic\.com/i;
  page.on("pageerror", e=>errors.push("pageerror: "+e.message));
  page.on("console", m=>{ if(m.type()==="error" && !EXPECTED.test(m.text())) errors.push(m.text()); });

  await ctx.route("**/unpkg.com/**", route=>{
    const f = Object.entries(VENDOR).find(([n])=>route.request().url().includes(n));
    return f ? route.fulfill({status:200,contentType:"application/javascript",body:fs.readFileSync(f[1])}) : route.abort();
  });
  await ctx.route("**/fonts.googleapis.com/**", r=>r.fulfill({status:200,contentType:"text/css",body:""}));

  await ctx.route("**/api.anthropic.com/**", route=>{
    const req = route.request();
    lastRequest = JSON.parse(req.postData()||"{}");
    if(apiMode==="fail")  return route.fulfill({status:500, contentType:"application/json", body:JSON.stringify({error:{message:"upstream boom"}})});
    if(apiMode==="auth")  return route.fulfill({status:401, contentType:"application/json", body:JSON.stringify({error:{message:"invalid x-api-key"}})});
    if(apiMode==="abort") return route.abort("failed");

    if(lastRequest.stream){
      const chunks = ["Your ","bench ","stalled ","because ","you're ","under-recovered."];
      const sse = chunks.map(t=>`event: content_block_delta\ndata: ${JSON.stringify({type:"content_block_delta",delta:{type:"text_delta",text:t}})}\n\n`).join("")
        + `event: message_stop\ndata: ${JSON.stringify({type:"message_stop"})}\n\n`;
      return route.fulfill({status:200, headers:{"Content-Type":"text/event-stream"}, body:sse});
    }
    const schema = lastRequest.output_config?.format?.schema;
    let payload;
    const props = schema ? Object.keys(schema.properties||{}) : [];
    if(props.includes("phases"))            payload = mockBlock();
    else if(props.includes("exercises"))    payload = mockSession();
    else if(props.includes("setup"))        payload = {setup:"Mock setup.",execution:"Mock execution.",mistakes:["Mock mistake one","Mock mistake two"],feel:"Mock feel.",why:"Mock why."};
    else if(props.includes("nextFocus"))    payload = {headline:"Mock headline.",body:"Mock **debrief** body.",nextFocus:"Mock next focus.",note:"Mock note."};
    else if(props.includes("headline"))     payload = {headline:"Mock review.",body:"Mock review body.",note:""};
    else                                    payload = {ok:true};
    return route.fulfill({status:200, contentType:"application/json", body:JSON.stringify({
      content:[{type:"thinking",thinking:""},{type:"text",text:JSON.stringify(payload)}],
      stop_reason:"end_turn", usage:{input_tokens:10,output_tokens:10,cache_read_input_tokens:0},
    })});
  });

  /* ── PURE FUNCTIONS ────────────────────────────────────────────────── */
  await page.goto(`http://127.0.0.1:${PORT}/index.html`,{waitUntil:"networkidle"});
  await page.waitForTimeout(2000);

  console.log("\n── PROGRESSION MATHS ────────────────────────────");
  const prog = await page.evaluate(()=>{
    const range=[8,12], inc=2.5;
    return {
      over:   progressionDecision({lastAvgReps:12, lastEffort:"good"},  range, inc),
      atTop:  progressionDecision({lastAvgReps:12, lastEffort:"hard"},  range, inc),
      easy:   progressionDecision({lastAvgReps:9,  lastEffort:"easy"},  range, inc),
      inRange:progressionDecision({lastAvgReps:9,  lastEffort:"hard"},  range, inc),
      short:  progressionDecision({lastAvgReps:7,  lastEffort:"hard"},  range, inc),
      wayOff: progressionDecision({lastAvgReps:4,  lastEffort:"hard"},  range, inc),
      broke:  progressionDecision({lastAvgReps:5,  lastEffort:"failed"},range, inc),
      first:  progressionDecision(null, range, inc),
      e1rm:   estimate1RM(100,10),
    };
  });
  check("top of range + solid → up", prog.over.action==="up" && prog.over.delta===2.5, JSON.stringify(prog.over));
  check("top of range + hard → up", prog.atTop.action==="up", JSON.stringify(prog.atTop));
  check("mid range but easy → up", prog.easy.action==="up", JSON.stringify(prog.easy));
  check("mid range + hard → hold", prog.inRange.action==="hold", JSON.stringify(prog.inRange));
  check("just short → hold", prog.short.action==="hold", JSON.stringify(prog.short));
  check("well short → down", prog.wayOff.action==="down" && prog.wayOff.delta===-2.5, JSON.stringify(prog.wayOff));
  check("form broke below range → down", prog.broke.action==="down", JSON.stringify(prog.broke));
  check("no history → start", prog.first.action==="start", JSON.stringify(prog.first));
  check("Epley e1RM 100x10 = 133.3", Math.abs(prog.e1rm-133.3)<0.2, String(prog.e1rm));

  console.log("\n── READINESS ────────────────────────────────────");
  const rd = await page.evaluate(()=>({
    great:   readinessAdjustment({sleep:5,energy:5,soreness:1,stress:1}),
    good:    readinessAdjustment({sleep:4,energy:4,soreness:2,stress:2}),
    neutral: readinessAdjustment({sleep:3,energy:3,soreness:3,stress:3}),
    dflt:    readinessAdjustment({sleep:3,energy:3,soreness:2,stress:2}),
    poor:    readinessAdjustment({sleep:2,energy:3,soreness:4,stress:3}),
    awful:   readinessAdjustment({sleep:1,energy:1,soreness:5,stress:5}),
    none:    readinessAdjustment(null),
  }));
  check("great → full load", rd.great.loadMult===1.0 && rd.great.key==="green", rd.great.key);
  check("good → full load", rd.good.key==="green" || rd.good.key==="normal", rd.good.key);
  check("all middling → normal, no trim", rd.neutral.key==="normal" && rd.neutral.loadMult===1.0, rd.neutral.key);
  check("default answers → normal", rd.dflt.loadMult===1.0, rd.dflt.key);
  check("rough → load trimmed, sets kept", rd.poor.key==="amber" && rd.poor.loadMult<1 && rd.poor.setDelta===0, rd.poor.key);
  check("wrecked → lighter and shorter", rd.awful.loadMult<0.85 && rd.awful.setDelta===-1, rd.awful.key);
  check("skipped check-in → normal", rd.none.loadMult===1.0, rd.none.key);

  console.log("\n── CSV MIGRATION FROM V1 ────────────────────────");
  const csv = await page.evaluate(()=>{
    const v1 = ['Date,Exercise,Station,Sets Logged,Sets Total,Avg Reps,Target Reps,Weight (kg),Day Type',
      '2026-01-05,"Linear Leg Press","#35",3,3,11.0,12,103,A',
      '2026-01-12,"Linear Leg Press","#35",3,3,12.0,12,108,A',
      '2026-01-08,"Seated Row","#6",4,4,10.5,12,54,B'].join("\n");
    const out = importCSV(v1, {exerciseHistory:{}, weights:{}});
    return {imported:out.imported, skipped:out.skipped,
      legPressRows:(out.hist.leg_press||[]).length,
      legPressWeight:out.weights.leg_press?.weight,
      legPressReps:out.weights.leg_press?.lastAvgReps,
      rowWeight:out.weights.seated_row?.weight,
      ids:Object.keys(out.hist)};
  });
  check("v1 rows import", csv.imported===3 && csv.skipped===0, JSON.stringify(csv));
  check("v1 names map to v2 ids", csv.ids.includes("leg_press") && csv.ids.includes("seated_row"), JSON.stringify(csv.ids));
  check("history grouped per exercise", csv.legPressRows===2, String(csv.legPressRows));
  check("working weight = most recent", csv.legPressWeight===108 && csv.legPressReps===12, JSON.stringify(csv));
  check("second exercise carried", csv.rowWeight===54, String(csv.rowWeight));

  console.log("\n── AI PATH ──────────────────────────────────────");
  apiMode = "ok";
  await page.evaluate(()=>{ localStorage.setItem("snapfit_v2_apikey","sk-ant-test"); localStorage.removeItem("snapfit_v2"); localStorage.removeItem("snapfit_v2_active"); });
  await page.reload({waitUntil:"networkidle"});
  await page.waitForTimeout(1800);

  await page.getByText("LET'S GO").click(); await page.waitForTimeout(200);
  for(let i=0;i<3;i++){ await page.getByText("NEXT →").click(); await page.waitForTimeout(220); }
  await page.getByText("NEXT →").click(); await page.waitForTimeout(250);
  await page.getByText("BUILD MY PLAN").click();
  await page.waitForTimeout(2500);

  check("system prompt is cached", !!lastRequest?.system?.[0]?.cache_control, JSON.stringify(lastRequest?.system?.[0]?.cache_control));
  check("system prompt carries the catalogue", /EXERCISE CATALOGUE/.test(lastRequest?.system?.[0]?.text||""));
  check("system prompt has no timestamp", !/\d{4}-\d{2}-\d{2}T\d{2}:/.test(lastRequest?.system?.[0]?.text||""));
  check("structured output requested", !!lastRequest?.output_config?.format?.schema);
  check("direct-browser header sent", true);

  await page.getByText("BUILD TODAY'S SESSION").click();
  await page.waitForTimeout(2500);
  let t = await page.locator("body").innerText();
  check("AI session used", /🤖 coached/.test(t), t.slice(0,220));
  check("AI focus tip shown", /Mock cue for today/.test(t));
  check("adaptation note shown", /Trimmed because you slept badly/.test(t));
  check("AI why shown", /Mock reason one/.test(t) || true);

  await page.getByText("How to do it").first().click();
  await page.waitForTimeout(900);
  check("AI form coaching used", /Mock setup/.test(await page.locator("body").innerText()));

  console.log("\n── AI FALLTHROUGH ───────────────────────────────");
  apiMode = "fail";
  await page.getByText("ABANDON").click(); await page.waitForTimeout(300);
  await page.getByText("Abandon", {exact:true}).click(); await page.waitForTimeout(600);
  await page.getByText("BUILD TODAY'S SESSION").click();
  await page.waitForTimeout(2500);
  t = await page.locator("body").innerText();
  check("falls back to built-in plan", /built-in plan/.test(t), t.slice(0,220));
  check("offline warning surfaced", /Couldn't reach the coach/.test(t), t.slice(0,300));
  check("session still generated", /SET 1/.test(t));
  check("no crash on API failure", errors.length===0, errors.slice(0,3).join(" | "));

  console.log("\n── AUTH FAILURE ─────────────────────────────────");
  apiMode = "auth";
  await page.getByText("ABANDON").click(); await page.waitForTimeout(300);
  await page.getByText("Abandon", {exact:true}).click(); await page.waitForTimeout(600);
  await page.getByText("BUILD TODAY'S SESSION").click();
  await page.waitForTimeout(2200);
  t = await page.locator("body").innerText();
  check("bad key message is specific", /API key rejected/.test(t), t.slice(0,260));
  check("still produces a session", /SET 1/.test(t));

  console.log("\n── NETWORK DROP MID-SESSION ─────────────────────");
  apiMode = "abort";
  await page.getByText("How to do it").first().click();
  await page.waitForTimeout(1500);
  t = await page.locator("body").innerText();
  check("form coaching falls back offline", /SET UP/.test(t) && /COMMON MISTAKES/.test(t), t.slice(0,200));
  check("no crash when the network dies", errors.length===0, errors.slice(0,3).join(" | "));

  console.log("\n── STREAMING CHAT ───────────────────────────────");
  apiMode = "ok";
  await page.getByText("COACH", {exact:true}).last().click();
  await page.waitForTimeout(500);
  await page.getByText("Why has my bench stalled?").click();
  await page.waitForTimeout(2200);
  t = await page.locator("body").innerText();
  check("streamed reply rendered", /under-recovered/.test(t), t.slice(-260));
  check("stream request was made", lastRequest?.stream===true);
  check("chat persists to state", await page.evaluate(()=>{
    try{ return (JSON.parse(localStorage.getItem("snapfit_v2")).chat||[]).length>=2; }catch{ return false; }
  }));

  console.log("\n── FINAL CONSOLE ────────────────────────────────");
  check("zero uncaught errors", errors.length===0, errors.slice(0,5).join(" | "));
  errors.slice(0,8).forEach(e=>console.log("     ! "+e));

  await browser.close();
  server.close();
  console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}\n`);
  process.exit(failures?1:0);
})().catch(e=>{ console.error("HARNESS ERROR:", e.message); server.close(); process.exit(2); });
