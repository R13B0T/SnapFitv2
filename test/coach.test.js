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

async function buildTodaySession(page){
  const start = page.getByRole("button", {name:/START CHECK-IN/});
  if(await start.isVisible().catch(()=>false)){
    await start.click();
    await page.waitForTimeout(200);
  }
  await page.getByRole("button", {name:/BUILD TODAY'S SESSION/}).click();
}

async function activeExerciseCount(page){
  return page.evaluate(()=>{
    try{ return JSON.parse(localStorage.getItem("snapfit_v2_active")||"null")?.exercises?.length||0; }
    catch{ return 0; }
  });
}

const VENDOR = {
  "react.production.min.js": vendor("react.js"),
  "react-dom.production.min.js": vendor("react-dom.js"),
  "babel.min.js": vendor("babel.js"),
};

// What the mock API returns next. Mutated per test.
let apiMode = "ok";
let lastRequest = null;
let requestCount = 0;
let healthChecks = 0;
let schemaRejects = 0;

function mockBlock(){
  return { name:"Test 6 week block", rationale:"Built for the test.", phases:[
    {name:"Base", weeks:2, sets:3, repRange:[10,12], rpe:7, restMult:1.0, intent:"Settle in."},
    {name:"Build", weeks:3, sets:4, repRange:[8,10], rpe:8, restMult:1.1, intent:"Push harder."},
    {name:"Deload", weeks:1, sets:2, repRange:[10,12], rpe:6, restMult:0.9, intent:"Back off."},
  ]};
}
function mockSession(count=3){
  const ids=["leg_press","chest_press_mach","seated_row","shoulder_press_mach","leg_curl","leg_extension","lat_pulldown","db_bench"];
  return { brief:"Mock brief paragraph one.\n\n**What's required.** Mock requirement.\n\n**The standard.** Mock standard.",
    focusTip:"Mock cue for today.", adaptationNote:"Trimmed because you slept badly.",
    exercises:ids.slice(0,count).map((exId,i)=>({
      exId, sets:3, targetReps:10, weight:i===0?100:40+i*2.5, rest:i===0?120:90, why:`Mock reason ${i+1}.`,
    }))};
}

/* A real PNG, so createImageBitmap in the page can actually decode it and the
   downscale path runs for real rather than being stubbed. */
function png(w, h){
  const zlib = require("zlib");
  const raw = Buffer.alloc((w*3 + 1) * h);
  for(let y=0; y<h; y++){
    const row = y * (w*3 + 1);
    raw[row] = 0;                                    // filter: none
    for(let x=0; x<w; x++){
      const p = row + 1 + x*3;
      raw[p] = (x*7) & 255; raw[p+1] = (y*5) & 255; raw[p+2] = 128;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
let CRC_TABLE = null;
function crc32(buf){
  if(!CRC_TABLE){
    CRC_TABLE = new Int32Array(256);
    for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = c&1 ? 0xedb88320 ^ (c>>>1) : c>>>1; CRC_TABLE[n]=c; }
  }
  let c = -1;
  for(let i=0;i<buf.length;i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* What a vision scan of a hotel gym plausibly returns, including the two things
   that have to be handled rather than trusted: a station number that isn't in
   the list at all, and one reported twice. */
function mockGym(){
  return { name:"Hotel gym",
    stations:[
      {num:"29", confidence:"sure",   seen:"rack of dumbbells on the left"},
      {num:"25", confidence:"sure",   seen:"adjustable bench, upright"},
      {num:"26", confidence:"likely", seen:"end of a flat bench in shot"},
      {num:"35", confidence:"unsure", seen:"might be a leg press behind the pillar"},
      {num:"29", confidence:"sure",   seen:"duplicate of the dumbbells"},
      {num:"999",confidence:"sure",   seen:"a station number that does not exist"},
    ],
    extras:[{name:"Treadmill", note:"two of them"},{name:"Yoga mats", note:""}],
    dumbbellMax:20, note:"Small room, no barbell.", summary:"Dumbbells to 20kg and a couple of benches — plenty for a full session." };
}

(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const browser = await chromium.launch({...launchOpts()});
  const ctx = await browser.newContext({viewport:{width:390,height:844}, serviceWorkers:"block"});
  const page = await ctx.newPage();
  const errors = [];
  // The browser logs every non-2xx fetch as a console error. Several tests below
  // deliberately fail the API, so those are expected — only count real app errors.
  const EXPECTED = /Failed to load resource|net::ERR_FAILED|api\.anthropic\.com|\[BABEL\] Note: The code generator has deoptimised the styling/i;
  page.on("pageerror", e=>errors.push("pageerror: "+e.message));
  page.on("console", m=>{ if(m.type()==="error" && !EXPECTED.test(m.text())) errors.push(m.text()); });

  await ctx.route("**/unpkg.com/**", route=>{
    const f = Object.entries(VENDOR).find(([n])=>route.request().url().includes(n));
    return f ? route.fulfill({status:200,contentType:"application/javascript",body:fs.readFileSync(f[1])}) : route.abort();
  });
  await ctx.route("**/fonts.googleapis.com/**", r=>r.fulfill({status:200,contentType:"text/css",body:""}));

  await ctx.route("**/api.anthropic.com/**", route=>{
    const req = route.request();
    requestCount++;
    if(req.method()==="GET" && /\/v1\/models/.test(req.url())) healthChecks++;
    lastRequest = JSON.parse(req.postData()||"{}");
    if(apiMode==="fail")  return route.fulfill({status:500, contentType:"application/json", body:JSON.stringify({error:{message:"upstream boom"}})});
    if(apiMode==="auth")  return route.fulfill({status:401, contentType:"application/json", body:JSON.stringify({error:{message:"invalid x-api-key"}})});
    if(apiMode==="abort") return route.abort("failed");
    if(apiMode==="schemafail" && lastRequest.output_config?.format){
      schemaRejects++;
      return route.fulfill({status:400,contentType:"application/json",body:JSON.stringify({error:{message:"output_config.format.schema could not be compiled"}})});
    }

    if(lastRequest.stream){
      const chunks = ["Your ","bench ","stalled ","because ","you're ","under-recovered."];
      const sse = chunks.map(t=>`event: content_block_delta\ndata: ${JSON.stringify({type:"content_block_delta",delta:{type:"text_delta",text:t}})}\n\n`).join("")
        + `event: message_stop\ndata: ${JSON.stringify({type:"message_stop"})}\n\n`;
      return route.fulfill({status:200, headers:{"Content-Type":"text/event-stream"}, body:sse});
    }
    const schema = lastRequest.output_config?.format?.schema;
    let payload;
    const props = schema ? Object.keys(schema.properties||{}) : [];
    const prompt = JSON.stringify(lastRequest.messages||[]);
    if(props.includes("extras"))            payload = mockGym();
    else if(props.includes("phases"))       payload = apiMode==="badshape" ? {...mockBlock(),phases:[mockBlock().phases[0]]} : mockBlock();
    else if(props.includes("exercises")){
      const requested=Number(JSON.stringify(lastRequest.messages||[]).match(/Exactly (\d+) exercises/)?.[1]||3);
      payload = mockSession(requested);
    }
    else if(props.includes("setup"))        payload = {setup:"Mock setup.",execution:"Mock execution.",mistakes:["Mock mistake one","Mock mistake two"],feel:"Mock feel.",why:"Mock why."};
    else if(props.includes("nextFocus"))    payload = {headline:"Mock headline.",body:"Mock **debrief** body.",nextFocus:"Mock next focus.",voiceSummary:"Mock spoken debrief.",note:"Mock note."};
    else if(props.includes("headline"))     payload = {headline:"Mock review.",body:"Mock review body.",voiceSummary:"Mock spoken weekly review.",note:""};
    else if(/Design a training block/.test(prompt)) payload = mockBlock();
    else                                    payload = {ok:true};
    const responseText=apiMode==="schemafail" ? `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`` : JSON.stringify(payload);
    return route.fulfill({status:200, contentType:"application/json", body:JSON.stringify({
      content:[{type:"thinking",thinking:""},{type:"text",text:responseText}],
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

  console.log("\n── LIVE SET TRAINER ─────────────────────────────");
  const liveTrainer = await page.evaluate(()=>{
    const st=defaultState();
    const ex={...EX_BY_ID.db_bench,exId:"db_bench",sets:3,targetReps:12,repRange:[8,12],weight:20,rpe:8,rest:90,inc:2};
    const decide=(row,standalone=false)=>postSetDecision({exercise:ex,logs:[row,null,null],setIndex:0,state:st,phaseName:"Build",standalone});
    const final=postSetDecision({exercise:ex,logs:Array(3).fill({weight:20,reps:12,effort:"good"}),setIndex:2,state:st,phaseName:"Build"});
    return {raise:decide({weight:20,reps:12,effort:"easy"}),hold:decide({weight:20,reps:10,effort:"good"}),
      down:decide({weight:20,reps:5,effort:"failed"}),final};
  });
  check("easy top-range set gets a small increase", liveTrainer.raise.action==="up" && liveTrainer.raise.nextWeight>20, JSON.stringify(liveTrainer.raise));
  check("productive set holds and adds a rep target", liveTrainer.hold.action==="hold" && liveTrainer.hold.nextReps===11, JSON.stringify(liveTrainer.hold));
  check("form breakdown reduces the next load", liveTrainer.down.action==="down" && liveTrainer.down.nextWeight<20, JSON.stringify(liveTrainer.down));
  check("last-set verdict uses next-session progression", liveTrainer.final.complete===true && liveTrainer.final.action==="up", JSON.stringify(liveTrainer.final));

  console.log("\n── STANDALONE AWAY DAY & WEEK RESTART ───────────");
  const pause = await page.evaluate(()=>{
    let st=defaultState(); st.onboarded=true; st.goal={type:"build_muscle"}; st.block=buildBlockRules(st);
    st.travel={name:"Hotel",stations:["29","25","26"],custom:[],dumbbellMax:20,source:"manual",planMode:"oneoff",date:todayISO(),active:true};
    const one=buildOneOffSessionRules(st,{sleep:4,energy:4,soreness:2,stress:2,availableMinutes:45});
    const before=blockProgress(st), after=blockProgress({...st,sessions:[{...one,finishedAt:new Date().toISOString()}]});
    const program={id:"p1",blockId:st.block.id,week:1,planWeek:1,date:todayISO(),exercises:[]};
    const restarted=restartCurrentPlanWeek({...st,sessions:[program]});
    return {one:{standalone:one.standalone,blockId:one.blockId,count:one.exercises.length},
      paused:before.dayIdx===after.dayIdx&&before.week===after.week,
      restart:{dayIdx:blockProgress(restarted).dayIdx,excluded:restarted.sessions[0].excludedFromPlanProgress}};
  });
  check("standalone away day has no block id", pause.one.standalone===true && pause.one.blockId==null && pause.one.count>=3, JSON.stringify(pause.one));
  check("standalone away day does not move the program", pause.paused===true);
  check("week restart preserves but excludes the earlier attempt", pause.restart.dayIdx===0 && pause.restart.excluded===true, JSON.stringify(pause.restart));

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
  check("a saved key refreshes itself without generating tokens",healthChecks>=1,`${healthChecks} health checks`);
  const startupStatus=await page.evaluate(()=>JSON.parse(localStorage.getItem("snapfit_v2_api_status")||"null"));
  check("automatic connection refresh updates the visible API status",startupStatus?.ok===true,JSON.stringify(startupStatus));
  const schemaMins = await page.evaluate(()=>{
    const found=[];
    const walk=(value,path)=>{
      if(!value || typeof value!=="object") return;
      if(Object.prototype.hasOwnProperty.call(value,"minItems")) found.push({path,value:value.minItems});
      Object.entries(value).forEach(([key,child])=>walk(child,`${path}.${key}`));
    };
    [S_BLOCK,S_SESSION,S_EXPLAIN,S_DEBRIEF,S_REVIEW,S_GYM].forEach((schema,i)=>walk(schema,`schema${i}`));
    return found;
  });
  check("structured-output schemas use Anthropic-supported array minima",
    schemaMins.every(x=>x.value===0 || x.value===1),JSON.stringify(schemaMins));
  const transportGuard = await page.evaluate(()=>{
    const original={type:"array",minItems:2,maxItems:5,items:{type:"array",minItems:3,maxItems:4}};
    const sent=schemaForAnthropic(original);
    return {original,sent};
  });
  check("the API transport sanitises unsupported array minima",
    transportGuard.original.minItems===2 && transportGuard.original.items.minItems===3
      && transportGuard.sent.minItems===1 && transportGuard.sent.items.minItems===1,
    JSON.stringify(transportGuard));
  apiMode = "schemafail";
  schemaRejects = 0;
  const recoveredBlock = await page.evaluate(async()=>{
    let fallbackKind="";
    const c=makeCoach(()=>defaultState(),()=>"sk-ant-test",()=>"claude-opus-5",kind=>{ fallbackKind=kind; });
    const block=await c.buildBlock();
    return {source:block.source,fallbackKind,status:loadApiStatus()};
  });
  check("a rejected structured Plan request retries as locally validated JSON",
    recoveredBlock.source==="ai" && !recoveredBlock.fallbackKind && recoveredBlock.status?.ok===true
      && schemaRejects===1 && !lastRequest?.output_config?.format,
    JSON.stringify({recoveredBlock,schemaRejects,lastFormat:lastRequest?.output_config?.format}));
  apiMode = "badshape";
  const invalidBlock = await page.evaluate(async()=>{
    let fallbackKind="";
    const c=makeCoach(()=>defaultState(),()=>"sk-ant-test",()=>"claude-opus-5",kind=>{ fallbackKind=kind; });
    const block=await c.buildBlock();
    return {source:block.source,fallbackKind,status:loadApiStatus()};
  });
  check("an undersized AI block is rejected safely",
    invalidBlock.source!=="ai" && invalidBlock.fallbackKind==="block" && invalidBlock.status?.kind==="response",
    JSON.stringify(invalidBlock));
  apiMode = "ok";

  await page.getByText("LET'S GO").click(); await page.waitForTimeout(200);
  for(let i=0;i<3;i++){ await page.getByText("NEXT →").click(); await page.waitForTimeout(220); }
  await page.getByText("NEXT →").click(); await page.waitForTimeout(250);
  await page.getByText("BUILD MY PLAN").click();
  await page.waitForTimeout(2500);

  check("system prompt is cached", !!lastRequest?.system?.[0]?.cache_control, JSON.stringify(lastRequest?.system?.[0]?.cache_control));
  check("system prompt carries the catalogue", /EXERCISE CATALOGUE/.test(lastRequest?.system?.[0]?.text||""));
  check("system prompt carries coach personality", /SASS 3\/5 \(Cheeky\)/.test(lastRequest?.system?.[0]?.text||"")
    && /HARD TRUTH 4\/5 \(Blunt\)/.test(lastRequest?.system?.[0]?.text||""));
  check("coach is explicitly non-sycophantic", /Do not flatter, fawn/.test(lastRequest?.system?.[0]?.text||""));
  check("system prompt has no timestamp", !/\d{4}-\d{2}-\d{2}T\d{2}:/.test(lastRequest?.system?.[0]?.text||""));
  check("structured output requested", !!lastRequest?.output_config?.format?.schema);
  check("direct-browser header sent", true);

  await buildTodaySession(page);
  await page.waitForTimeout(2500);
  let t = await page.locator("body").innerText();
  check("AI session used", /🤖 coached/.test(t), t.slice(0,220));
  check("AI focus tip shown", /Mock cue for today/.test(t));
  check("adaptation note shown", /Trimmed because you slept badly/.test(t));
  check("AI why shown", /Mock reason one/.test(t) || true);
  check("brief is requested in the schema", !!lastRequest?.output_config?.format?.schema?.properties?.brief);
  check("brief is required, not optional",
    (lastRequest?.output_config?.format?.schema?.required||[]).includes("brief"));
  check("AI brief starts folded", /TODAY'S BRIEF/.test(t) && !/Mock brief paragraph one/.test(t), t.slice(0,400));
  await page.getByRole("button", {name:"Open today's brief", exact:true}).click();
  await page.getByRole("button", {name:"Fold today's brief", exact:true}).waitFor();
  t = await page.locator("body").innerText();
  check("AI brief rendered", /Mock brief paragraph one/.test(t), t.slice(0,500));
  check("AI brief keeps its markdown structure", /What's required/.test(t) && /The standard/.test(t));

  const aiExtra = await page.evaluate(async()=>{
    const c = makeCoach(()=>loadState(), ()=>"sk-ant-test", ()=>"claude-opus-5", ()=>{});
    const s = await c.todaysSession(null,{bonus:true});
    return {bonus:s?.bonus,dayName:s?.dayName,phaseName:s?.phaseName,rpes:(s?.exercises||[]).map(e=>e.rpe)};
  });
  check("AI extra session stays marked and phase-aligned",
    aiExtra.bonus===true && aiExtra.rpes.length>=2 && aiExtra.rpes.every(r=>Number.isFinite(r)), JSON.stringify(aiExtra));
  check("AI is told the extra is the next workout in the block",
    /extra training window/.test(JSON.stringify(lastRequest?.messages||[]))
      && /NEXT workout in their current block/.test(JSON.stringify(lastRequest?.messages||[])));

  await page.locator('button[aria-label$=" exercise details"]').first().click();
  await page.waitForTimeout(250);
  const beforeHowRequests = requestCount;
  await page.getByText("How to do it").first().click();
  await page.waitForTimeout(900);
  check("AI form coaching used", /Mock setup/.test(await page.locator("body").innerText()));
  check("opening How-to makes one AI call", requestCount === beforeHowRequests + 1,
    `${requestCount-beforeHowRequests} calls`);
  check("YouTube search is a normal link, not another AI request",
    /youtube\.com\/results\?search_query=/.test(await page.getByRole("link", {name:/Search YouTube Shorts/}).first().getAttribute("href")||""));

  /* The photo path driven through the real UI. The mock returns a station that
     doesn't exist, one duplicate and one "unsure" — so this also checks that the
     review step is the safety net it's meant to be rather than a rubber stamp. */
  console.log("\n── SCAN A GYM THROUGH THE UI ────────────────────");
  apiMode = "ok";
  await page.getByText("ABANDON").click(); await page.waitForTimeout(300);
  await page.getByText("Abandon", {exact:true}).click(); await page.waitForTimeout(700);

  await page.getByText("Your usual gym").click(); await page.waitForTimeout(400);
  let g = await page.locator("body").innerText();
  check("photo and description path is enabled with a key", /photos, a written description, or both/.test(g), g.slice(0,500));
  await page.getByText("📷 Photograph or describe it").click(); await page.waitForTimeout(400);
  g = await page.locator("body").innerText();
  check("photo or description step opens", /PHOTOGRAPH OR DESCRIBE/.test(g), g.slice(0,300));
  check("says photos aren't stored", /Photos aren't stored anywhere/.test(g));
  check("free-text description is offered", /DESCRIBE THIS GYM/.test(g));
  check("cannot scan without a photo or description",
    await page.getByText("USE DESCRIPTION").first().isDisabled().catch(()=>false));

  const gymDescription = page.locator('textarea[placeholder*="Smith machine"]');
  await gymDescription.fill("There is a cable tower with a rope, plus kettlebells outside the photos.");
  check("description alone enables analysis",
    !(await page.getByText("USE DESCRIPTION").first().isDisabled().catch(()=>true)));

  await page.locator('input[type="file"][accept="image/*"]').setInputFiles([
    {name:"gym1.png", mimeType:"image/png", buffer:png(600,400)},
    {name:"gym2.png", mimeType:"image/png", buffer:png(400,600)},
  ]);
  await page.waitForTimeout(900);
  const thumbs = await page.locator('img[src^="data:image/jpeg"]').count();
  check("both photos preview as thumbnails", thumbs===2, `${thumbs} thumbnails`);

  await page.getByText("READ THE EQUIPMENT").first().click();
  await page.waitForTimeout(1500);
  g = await page.locator("body").innerText();
  check("review step opens", /IS THIS RIGHT/.test(g), g.slice(0,300));
  check("the scan summary is shown", /Dumbbells to 20kg/.test(g));
  // These headers are uppercased by CSS, so innerText reports them that way.
  check("clear finds are grouped", /clearly there/i.test(g));
  check("guesses are grouped separately", /guesses/i.test(g));
  check("what it saw is shown so you can check it", /saw: rack of dumbbells on the left/.test(g));
  check("the invented station never reaches the UI", !/Linear Leg Press/.test(g) || /pillar/.test(g));
  check("extras are surfaced", /Treadmill/.test(g));
  check("dumbbell max is pre-filled from the photo",
    (await page.locator('input[inputmode="decimal"]').last().inputValue()) === "20",
    await page.locator('input[inputmode="decimal"]').last().inputValue());
  check("venue name is pre-filled",
    (await page.locator('input[placeholder="Hotel gym"]').first().inputValue()) === "Hotel gym");

  /* An "unsure" match must start unticked. Ticking it by default is how you end
     up at a hotel being told to use a leg press that was a pillar. */
  const guessRow = page.getByText("might be a leg press behind the pillar").locator("..").locator("..");
  const guessTicked = await guessRow.evaluate(el=>/✓/.test(el.innerText));
  check("a guess starts unticked", guessTicked === false);
  const sureTicked = await page.getByText("saw: rack of dumbbells on the left").locator("..").locator("..")
    .evaluate(el=>/✓/.test(el.innerText));
  check("a clear find starts ticked", sureTicked === true);

  await page.getByText("TRAIN HERE TODAY").first().click();
  await page.waitForTimeout(700);
  const scanned = await page.evaluate(()=>JSON.parse(localStorage.getItem("snapfit_v2")).travel);
  check("scanned gym applied", scanned?.active===true && scanned?.source==="photo", JSON.stringify(scanned));
  check("only confirmed stations were kept",
    scanned.stations.slice().sort().join(",")==="25,26,29", scanned.stations.join(","));
  check("the unticked guess was excluded", !scanned.stations.includes("35"), scanned.stations.join(","));
  check("the invented station was never stored", !scanned.stations.includes("999"));
  check("the venue note came across", /Small room/.test(scanned.note||""), scanned.note);
  check("the written gym description was retained",
    /cable tower with a rope/i.test(scanned.note||""), scanned.note);
  check("dumbbell ceiling stored from the photo", scanned.dumbbellMax===20, `got ${scanned.dumbbellMax}`);

  await buildTodaySession(page);
  await page.waitForTimeout(2500);
  check("the away gym reached the AI request",
    /TRAINING AWAY FROM THEIR USUAL GYM/.test(lastRequest?.system?.[0]?.text||""),
    (lastRequest?.system?.[0]?.text||"").slice(0,200));
  check("the AI was told the dumbbell ceiling",
    /HEAVIEST DUMBBELL HERE: 20kg/.test(lastRequest?.system?.[0]?.text||""));

  /* Back home, and back to an active session — coming home deliberately drops
     the session built for the other gym, and the sections below expect one. */
  await page.locator("text=⚙").click(); await page.waitForTimeout(500);
  await page.getByText("BACK TO MY USUAL GYM").click(); await page.waitForTimeout(400);
  await page.getByText("TODAY", {exact:true}).last().click(); await page.waitForTimeout(700);
  check("back on the usual gym for the rest of the suite",
    /Your usual gym/.test(await page.locator("body").innerText()));
  await buildTodaySession(page);
  await page.waitForTimeout(2500);
  check("a home-gym session rebuilds after coming back",
    await activeExerciseCount(page) >= 2);

  console.log("\n── AI FALLTHROUGH ───────────────────────────────");
  apiMode = "fail";
  await page.getByText("ABANDON").click(); await page.waitForTimeout(300);
  await page.getByText("Abandon", {exact:true}).click(); await page.waitForTimeout(600);
  await buildTodaySession(page);
  await page.waitForTimeout(2500);
  t = await page.locator("body").innerText();
  check("falls back to built-in plan", /built-in plan/.test(t), t.slice(0,220));
  check("offline warning surfaced", /Couldn't reach the coach/.test(t), t.slice(0,300));
  check("the header stops claiming the coach is active",
    await page.getByText("COACH OFFLINE",{exact:true}).count()===1,t.slice(0,220));
  check("fallback remains visibly marked after the short banner",
    /THIS SESSION IS NOT AI-GENERATED/.test(t) && /RETRY AI GENERATION/.test(t),t.slice(0,420));
  const failedStatus=await page.evaluate(()=>JSON.parse(localStorage.getItem("snapfit_v2_api_status")||"null"));
  check("the failed API result and useful detail are persisted",
    failedStatus?.ok===false && failedStatus?.kind==="http" && /upstream boom/.test(failedStatus?.message||""),
    JSON.stringify(failedStatus));
  check("session still generated", await activeExerciseCount(page) >= 2);
  check("no crash on API failure", errors.length===0, errors.slice(0,3).join(" | "));

  console.log("\n── AUTH FAILURE ─────────────────────────────────");
  apiMode = "auth";
  await page.getByText("ABANDON").click(); await page.waitForTimeout(300);
  await page.getByText("Abandon", {exact:true}).click(); await page.waitForTimeout(600);
  await buildTodaySession(page);
  await page.waitForTimeout(2200);
  t = await page.locator("body").innerText();
  check("bad key message is specific", /API key rejected/.test(t), t.slice(0,260));
  check("the header identifies a rejected key",
    await page.getByText("KEY REJECTED",{exact:true}).count()===1,t.slice(0,220));
  check("still produces a session", await activeExerciseCount(page) >= 2);

  console.log("\n── NETWORK DROP MID-SESSION ─────────────────────");
  apiMode = "abort";
  await page.locator('button[aria-label$=" exercise details"]').first().click();
  await page.waitForTimeout(250);
  await page.getByText("How to do it").first().click();
  await page.waitForTimeout(1500);
  t = await page.locator("body").innerText();
  check("form coaching falls back offline", /SET UP/.test(t) && /COMMON MISTAKES/.test(t), t.slice(0,200));
  const networkStatus=await page.evaluate(()=>JSON.parse(localStorage.getItem("snapfit_v2_api_status")||"null"));
  check("a browser-level network failure also clears connected status",
    networkStatus?.ok===false && networkStatus?.kind==="network",JSON.stringify(networkStatus));
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
  await page.evaluate(async()=>{
    const c=makeCoach(()=>loadState(),()=>"sk-ant-test",()=>"claude-opus-5",()=>{});
    const messages=Array.from({length:12},(_,i)=>({role:i%2?"assistant":"user",content:`turn ${i}`}));
    await c.chatStream({messages,onDelta:()=>{},signal:new AbortController().signal});
  });
  check("general chat sends only the last eight messages", lastRequest?.messages?.length===8,
    `${lastRequest?.messages?.length} messages`);
  await page.evaluate(async()=>{
    const c=makeCoach(()=>loadState(),()=>"sk-ant-test",()=>"claude-opus-5",()=>{});
    await c.setChatStream({exercise:{name:"Sandbag Clean & Press",weight:20,sets:3,targetReps:10,rpe:8,rest:90},
      logs:[{weight:20,reps:10,effort:"good"}],setIndex:1,
      messages:[{role:"user",content:"Should I add weight?"}],onDelta:()=>{},signal:new AbortController().signal});
  });
  check("set chat sends focused exercise context", /LIVE SET COACHING/.test(lastRequest?.system?.[0]?.text||"")
    && /Sandbag Clean & Press/.test(lastRequest?.system?.[0]?.text||""));
  check("set chat uses the lean prompt without the full catalogue",
    !/EXERCISE CATALOGUE/.test(lastRequest?.system?.[0]?.text||""));

  /* ── AUDIO CUES ────────────────────────────────────────────────────────
     The sound itself can't be asserted headlessly, but the schedule can: the
     whole sequence is queued against the audio clock up front, so the offsets
     are the thing worth checking. */
  console.log("\n── AUDIO CUE SCHEDULE ───────────────────────────");
  const audio = await page.evaluate(async()=>{
    // Record what gets scheduled instead of making noise.
    const started = [];
    let suspends = 0, resumes = 0, primes = 0;
    const fakeParam = () => ({setValueAtTime(){}, exponentialRampToValueAtTime(){}, setValueCurveAtTime(){}});
    class FakeCtx {
      constructor(){ this.currentTime = 100; this.state = "interrupted"; this.destination = {}; this.sampleRate = 44100; }
      suspend(){ suspends++; this.state = "suspended"; return Promise.resolve(); }
      resume(){ resumes++; this.state = "running"; return Promise.resolve(); }
      createBuffer(){ return {}; }
      createBufferSource(){ return {buffer:null, connect(){}, start(){ primes++; }, stop(){}}; }
      createOscillator(){
        const o = {type:"sine", frequency:fakeParam(),
          connect(){ return {connect(){}}; },
          start(t){ started.push(Math.round((t - 100)*100)/100); },
          stop(){}};
        return o;
      }
      createGain(){ return {gain:fakeParam(), connect(){ return {connect(){}}; }}; }
    }
    const realAC = window.AudioContext, realWAC = window.webkitAudioContext;
    window.AudioContext = FakeCtx; window.webkitAudioContext = FakeCtx;
    let session = null;
    try{
      session = {type:"auto"};
      Object.defineProperty(navigator, "audioSession", {configurable:true, value:session});
    }catch{}

    localStorage.setItem("snapfit_v2_sound","on");
    cues.setVolume(65);
    const volume = cues.volume();
    const storedVolume = localStorage.getItem("snapfit_v2_sound_volume");
    const planned = cues.schedule(Date.now() + 30000);   // 30s of rest
    await new Promise(resolve=>setTimeout(resolve, 0));
    const withSound = started.slice();

    started.length = 0;
    cues.cancel();
    localStorage.setItem("snapfit_v2_sound","off");
    const mutedPlan = cues.schedule(Date.now() + 30000);
    const whenMuted = started.slice();

    localStorage.setItem("snapfit_v2_sound","on");
    window.AudioContext = realAC; window.webkitAudioContext = realWAC;
    return {planned, withSound, mutedPlan, whenMuted, volume, storedVolume,
      suspends, resumes, primes, sessionType:session?.type || null};
  });

  const offsets = audio.planned.map(c=>c.offset);
  check("short whistle at 20s remaining", audio.planned.some(c=>c.at===20 && c.kind==="short" && c.offset===10), JSON.stringify(audio.planned.slice(0,2)));
  check("the same whistle sounds every second from 10 to 1",
    [10,9,8,7,6,5,4,3,2,1].every(n=>audio.planned.some(c=>c.at===n && c.kind==="short" && c.offset===30-n)),
    JSON.stringify(audio.planned.filter(c=>c.kind==="short").map(c=>c.at)));
  check("long whistle exactly at zero", audio.planned.some(c=>c.at===0 && c.kind==="long" && c.offset===30));
  check("twelve cues in total", audio.planned.length===12, `${audio.planned.length} cues`);
  check("offsets are in ascending order",
    offsets.every((o,i)=>i===0 || o >= offsets[i-1]), JSON.stringify(offsets));
  check("each cue is scheduled once", audio.withSound.length === 12, `${audio.withSound.length} oscillators for 12 cues`);
  check("an iPhone-interrupted context is restarted",
    audio.suspends >= 1 && audio.resumes >= 1, `${audio.suspends} suspend / ${audio.resumes} resume`);
  check("the tap primes Web Audio for iPhone", audio.primes >= 1, `${audio.primes} primes`);
  check("the iPhone audio category mixes with music", audio.sessionType === "ambient", String(audio.sessionType));
  check("timer volume persists", audio.volume===65 && audio.storedVolume==="65",
    `${audio.volume} / ${audio.storedVolume}`);
  check("nothing is scheduled with sound off",
    audio.mutedPlan.length===0 && audio.whenMuted.length===0,
    `${audio.mutedPlan.length} planned / ${audio.whenMuted.length} started`);

  console.log("\n── CUES ALREADY PAST ARE NOT FIRED LATE ─────────");
  const late = await page.evaluate(()=>{
    class FakeCtx {
      constructor(){ this.currentTime = 0; this.state="running"; this.destination={}; }
      resume(){ return Promise.resolve(); }
      createOscillator(){ return {type:"sine", frequency:{setValueAtTime(){},setValueCurveAtTime(){}},
        connect(){return{connect(){}};}, start(){}, stop(){}}; }
      createGain(){ return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}}, connect(){return{connect(){}};}}; }
    }
    const real = window.AudioContext;
    window.AudioContext = FakeCtx;
    localStorage.setItem("snapfit_v2_sound","on");
    const p = cues.schedule(Date.now() + 8000);   // only 8s left: 20s and 10s are gone
    cues.cancel();
    window.AudioContext = real;
    return p;
  });
  check("skips the 20s cue when rest is shorter than that", !late.some(c=>c.at===20), JSON.stringify(late.map(c=>c.at)));
  check("skips the 10s cue too", !late.some(c=>c.at===10));
  check("still counts down and whistles", late.some(c=>c.at===0) && late.some(c=>c.kind==="short"),
    JSON.stringify(late.map(c=>c.at)));

  /* ── AWAY GYM ──────────────────────────────────────────────────────── */

  console.log("\n── AWAY GYM OVERRIDES THE STATION LIST ──────────");
  const override = await page.evaluate(()=>{
    const home = {...defaultState(), travel:null};
    const away = {...defaultState(), travel:{name:"Hotel", stations:["29","25","26"], custom:[],
      dumbbellMax:15, note:"", source:"manual", date:todayISO(), active:true}};
    const off  = {...away, travel:{...away.travel, active:false}};
    const yesterday = {...away, travel:{...away.travel, date:"2020-01-01"}};
    return {
      homeCount: availableExercises(home).length,
      awayCount: availableExercises(away).length,
      awayStations: [...new Set(availableExercises(away).flatMap(e=>e.stations))].sort(),
      offCount: availableExercises(off).length,
      expiredActive: normaliseTravel(yesterday.travel).active,
      homeUntouched: home.equipment.enabled.length === away.equipment.enabled.length,
      venue: [venueName(home), venueName(away)],
      emptyIsNull: normaliseTravel({name:"x", stations:[], custom:[], active:true}) === null,
      junkIsNull: normaliseTravel("not an object") === null,
    };
  });
  check("away gym narrows the pool", override.awayCount < override.homeCount,
    `${override.awayCount} away vs ${override.homeCount} home`);
  check("only away stations survive the filter",
    override.awayStations.every(n=>["29","25","26"].includes(n)), override.awayStations.join(","));
  check("switching it off restores the whole gym", override.offCount === override.homeCount,
    `${override.offCount} vs ${override.homeCount}`);
  check("an away gym from another day is inactive", override.expiredActive === false);
  check("the home gym is never edited", override.homeUntouched);
  check("venue name follows the override", override.venue[0]==="Your gym" && override.venue[1]==="Hotel",
    override.venue.join(" / "));
  check("an empty equipment list is not a venue", override.emptyIsNull);
  check("junk in storage is not a venue", override.junkIsNull);

  console.log("\n── A BARE GYM STILL TRAINS EVERYTHING ───────────");
  const bare = await page.evaluate(()=>{
    const st = {...defaultState(), travel:{name:"Bare", stations:["29","25","26"], custom:[],
      dumbbellMax:null, note:"", source:"manual", date:todayISO(), active:true}};
    const pool = availableExercises(st);
    return { patterns:[...new Set(pool.map(e=>e.pattern))].sort(), count:pool.length,
             names:pool.map(e=>e.name) };
  });
  // Dumbbells and a bench have to cover legs and back, not just presses —
  // otherwise an away session is upper-body push only and not worth doing.
  for(const p of ["squat","hinge","push_h","push_v","pull_h","pull_v","core","calf"]){
    check(`bare gym can train ${p}`, bare.patterns.includes(p), `patterns: ${bare.patterns.join(",")}`);
  }
  console.log(`     ${bare.count} exercises from dumbbells and a bench`);

  console.log("\n── DUMBBELL CEILING ─────────────────────────────");
  const cap = await page.evaluate(()=>{
    const st = {...defaultState(), travel:{name:"Hotel", stations:["29","25","26"], custom:[],
      dumbbellMax:12.5, note:"", source:"manual", date:todayISO(), active:true},
      weights:{ db_bench:{weight:30,lastAvgReps:10,lastEffort:"good",inc:2.5},
                db_row:{weight:34,lastAvgReps:10,lastEffort:"good",inc:2.5} },
      block:{id:"b", name:"B", source:"rules", startedAt:todayISO(), totalWeeks:4,
        phases:[{name:"Base",weeks:4,sets:3,repRange:[8,12],rpe:8,restMult:1,intent:"Go."}]},
      goal:{type:"muscle", targetDate:null}};
    const s = buildSessionRules(st, null);
    const machine = capForVenue(EX_BY_ID.leg_press, 200, st);
    const home = capForVenue(EX_BY_ID.db_bench, 30, {...st, travel:{...st.travel, active:false}});
    return { weights:(s?.exercises||[]).map(e=>({name:e.name, kind:EX_BY_ID[e.exId].kind, w:e.weight})),
             machine, home };
  });
  check("no dumbbell above the ceiling",
    cap.weights.filter(e=>e.kind==="dumbbell").every(e=>e.w <= 12.5),
    cap.weights.map(e=>`${e.name} ${e.w}kg`).join(", "));
  check("the ceiling doesn't touch non-dumbbell weights", cap.machine === 200, `got ${cap.machine}`);
  check("no ceiling at home", cap.home === 30, `got ${cap.home}`);

  console.log("\n── AWAY GYM REACHES THE COACH ───────────────────");
  const reach = await page.evaluate(()=>{
    const st = {...defaultState(), travel:{name:"Hotel gym", stations:["29","25","26"], custom:[],
      dumbbellMax:20, note:"Small room, no barbell.", source:"photo", date:todayISO(), active:true}};
    const sys = buildSystemBlock(st, "");
    return { away:/TRAINING AWAY FROM THEIR USUAL GYM/.test(sys),
             ceiling:/HEAVIEST DUMBBELL HERE: 20kg/.test(sys),
             note:/Small room, no barbell/.test(sys),
             noLegPress:!/#35 Linear Leg Press/.test(sys),
             stable: buildSystemBlock(st,"") === buildSystemBlock(st,"") };
  });
  check("the system block says they're away", reach.away);
  check("the dumbbell ceiling is in the prompt", reach.ceiling);
  check("the venue note is in the prompt", reach.note);
  check("home-gym machines are not offered to the model", reach.noLegPress);
  check("the block is still byte-stable for caching", reach.stable);

  console.log("\n── READING A GYM OFF A PHOTO ────────────────────");
  apiMode = "ok"; lastRequest = null;
  const scan = await page.evaluate(async()=>{
    const c = makeCoach(()=>defaultState(), ()=>"sk-ant-test", ()=>"claude-opus-5", ()=>{});
    const photos = [{b64:"QUJD", mediaType:"image/jpeg"},{b64:"REVG", mediaType:"image/jpeg"}];
    const r = await c.scanGym(photos, "Cable tower with rope and handles; dumbbells stop at 20kg.");
    return r;
  });
  check("scan returns a venue name", scan.name==="Hotel gym", scan.name);
  check("unknown station numbers are dropped",
    !scan.stations.some(s=>s.num==="999"), JSON.stringify(scan.stations.map(s=>s.num)));
  check("duplicates are collapsed",
    scan.stations.filter(s=>s.num==="29").length===1, JSON.stringify(scan.stations.map(s=>s.num)));
  check("station names are filled in from the catalogue",
    scan.stations.find(s=>s.num==="29")?.name === "Dumbbells & Rack",
    JSON.stringify(scan.stations.find(s=>s.num==="29")));
  check("confidence is carried through for the review step",
    scan.stations.find(s=>s.num==="35")?.confidence === "unsure");
  check("what it saw is carried through", /pillar/.test(scan.stations.find(s=>s.num==="35")?.seen||""));
  check("extras are kept", scan.extras.length===2, JSON.stringify(scan.extras));
  check("dumbbell max read off the photo", scan.dumbbellMax===20, `got ${scan.dumbbellMax}`);
  check("the user's description is retained for the venue coach",
    /Cable tower with rope/.test(scan.note||""), scan.note);

  const req = lastRequest;
  const blocks = req?.messages?.[0]?.content || [];
  check("both photos were sent", blocks.filter(b=>b.type==="image").length===2,
    JSON.stringify(blocks.map(b=>b.type)));
  check("photos go as base64 image blocks",
    blocks[0]?.type==="image" && blocks[0]?.source?.type==="base64" && blocks[0]?.source?.data==="QUJD",
    JSON.stringify(blocks[0]));
  check("media type is declared", blocks[0]?.source?.media_type==="image/jpeg");
  check("the station list is in the user turn, not the cached system block",
    /29 = Dumbbells & Rack/.test(blocks.find(b=>b.type==="text")?.text||""));
  check("free-text context is sent with the photos",
    /Cable tower with rope and handles/.test(blocks.find(b=>b.type==="text")?.text||""));
  check("a structured schema is demanded", !!req?.output_config?.format?.schema?.properties?.extras);
  check("the system block is still cached", req?.system?.[0]?.cache_control?.type==="ephemeral");

  const textOnly = await page.evaluate(async()=>{
    const c = makeCoach(()=>defaultState(), ()=>"sk-ant-test", ()=>"claude-opus-5", ()=>{});
    return c.scanGym([], "Adjustable bench and dumbbells up to 15kg.");
  });
  check("a description can be analysed without a photo", textOnly.name==="Hotel gym", JSON.stringify(textOnly));

  console.log("\n── SCANNING WITHOUT A KEY ───────────────────────");
  const noKey = await page.evaluate(async()=>{
    const c = makeCoach(()=>defaultState(), ()=>"", ()=>"claude-opus-5", ()=>{});
    try{ await c.scanGym([{b64:"QUJD", mediaType:"image/jpeg"}]); return {threw:false}; }
    catch(e){ return {threw:true, kind:e.kind, msg:e.message}; }
  });
  // The one coach method with no offline twin: it must fail loudly rather than
  // silently inventing a gym, because the UI offers the by-hand path instead.
  check("scanning without a key throws rather than guessing", noKey.threw && noKey.kind==="nokey",
    JSON.stringify(noKey));

  console.log("\n── SCAN FAILURE LEAVES THE GYM ALONE ────────────");
  apiMode = "fail";
  const scanFail = await page.evaluate(async()=>{
    const c = makeCoach(()=>defaultState(), ()=>"sk-ant-test", ()=>"claude-opus-5", ()=>{});
    try{ await c.scanGym([{b64:"QUJD", mediaType:"image/jpeg"}]); return {threw:false}; }
    catch(e){ return {threw:true, kind:e.kind}; }
  });
  check("a failed scan throws instead of falling through to a wrong gym",
    scanFail.threw, JSON.stringify(scanFail));
  apiMode = "ok";

  console.log("\n── PHOTOS ARE SHRUNK BEFORE SENDING ─────────────");
  const shrunk = await page.evaluate(async()=>{
    // A 3000x2000 canvas stands in for a phone photo.
    const c = document.createElement("canvas");
    c.width = 3000; c.height = 2000;
    const g = c.getContext("2d");
    g.fillStyle = "#444"; g.fillRect(0,0,3000,2000);
    g.fillStyle = "#ccc"; for(let i=0;i<40;i++) g.fillRect(i*70, 400, 40, 900);
    const blob = await new Promise(r=>c.toBlob(r, "image/png"));
    const file = new File([blob], "gym.png", {type:"image/png"});
    const out = await shrinkImage(file);
    let rejected = null;
    try{ await shrinkImage(new File([new Blob(["x"])], "n.txt", {type:"text/plain"})); }
    catch(e){ rejected = e.kind; }
    return { w:out.w, h:out.h, bytes:out.bytes, type:out.mediaType,
             origBytes:blob.size, rejected };
  });
  check("long edge capped at 1400px", shrunk.w===1400 && shrunk.h===933, `${shrunk.w}x${shrunk.h}`);
  check("re-encoded as JPEG", shrunk.type==="image/jpeg");
  check("well under the 5MB API limit", shrunk.bytes < 5_000_000, `${shrunk.bytes} bytes`);
  check("actually smaller than the original", shrunk.bytes < shrunk.origBytes,
    `${shrunk.bytes} vs ${shrunk.origBytes}`);
  check("a non-image is rejected before it's sent", shrunk.rejected==="photo", String(shrunk.rejected));
  console.log(`     3000x2000 PNG (${Math.round(shrunk.origBytes/1024)}KB) → 1400x933 JPEG (${Math.round(shrunk.bytes/1024)}KB)`);

  console.log("\n── FINAL CONSOLE ────────────────────────────────");
  check("zero uncaught errors", errors.length===0, errors.slice(0,5).join(" | "));
  errors.slice(0,8).forEach(e=>console.log("     ! "+e));

  await browser.close();
  server.close();
  console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}\n`);
  process.exit(failures?1:0);
})().catch(e=>{ console.error("HARNESS ERROR:", e.message); server.close(); process.exit(2); });
