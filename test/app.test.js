const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { vendor, launchOpts } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PORT = 8899;

const MIME = {".html":"text/html",".js":"application/javascript",".json":"application/json",".css":"text/css",".mp3":"audio/mpeg"};

const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split("?")[0]);
  if(p==="/") p="/index.html";
  const f = path.join(ROOT,p);
  if(!f.startsWith(ROOT) || !fs.existsSync(f)){ res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200,{"Content-Type": MIME[path.extname(f)]||"text/plain"});
  res.end(fs.readFileSync(f));
});

const errors = [];
const logs = [];
let failures = 0;

/* WCAG relative luminance and contrast ratio, for the theme checks. Takes
   either "#rrggbb" or the "rgb(r, g, b)" that getComputedStyle returns. */
function luminance(c){
  let r,g,b;
  const m = String(c).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if(m){ [r,g,b] = m.slice(1,4).map(Number); }
  else {
    const h = String(c).trim().replace("#","");
    const f = h.length===3 ? h.split("").map(x=>x+x).join("") : h;
    [r,g,b] = [0,2,4].map(i=>parseInt(f.slice(i,i+2),16));
  }
  const lin = [r,g,b].map(v=>{ v/=255; return v<=0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4; });
  return 0.2126*lin[0] + 0.7152*lin[1] + 0.0722*lin[2];
}
function contrast(a,b){
  const x = luminance(a), y = luminance(b);
  return (Math.max(x,y)+0.05) / (Math.min(x,y)+0.05);
}

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

(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const browser = await chromium.launch({
    ...launchOpts(),
  });
  const ctx = await browser.newContext({viewport:{width:390,height:844}, serviceWorkers:"block"});
  const page = await ctx.newPage();

  // unpkg is unreachable from this sandbox — serve the same UMD builds from npm.
  const VENDOR = {
    "react.production.min.js": vendor("react.js"),
    "react-dom.production.min.js": vendor("react-dom.js"),
    "babel.min.js": vendor("babel.js"),
  };
  await ctx.route("**/unpkg.com/**", route=>{
    const file = Object.entries(VENDOR).find(([n])=>route.request().url().includes(n));
    if(!file) return route.abort();
    route.fulfill({status:200, contentType:"application/javascript", body:fs.readFileSync(file[1])});
  });
  await ctx.route("**/fonts.googleapis.com/**", route=>route.fulfill({status:200,contentType:"text/css",body:""}));
  // Backup restore deliberately includes a fake key. The app now verifies a
  // saved key automatically, so keep this general harness off the real API.
  await ctx.route("**/api.anthropic.com/v1/models**", route=>route.fulfill({
    status:200,contentType:"application/json",body:JSON.stringify({data:[{id:"claude-opus-5"}]})}));

  page.on("console", m=>{
    const msg=m.text();
    logs.push(`${m.type()}: ${msg}`);
    if(m.type()==="error" && !/\[BABEL\] Note: The code generator has deoptimised the styling/.test(msg)) errors.push(msg);
  });
  page.on("pageerror", e=>errors.push("pageerror: "+e.message));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, {waitUntil:"networkidle"});
  await page.waitForTimeout(2500);

  console.log("\n── BOOT ─────────────────────────────────────────");
  const rootHtml = await page.locator("#root").innerHTML();
  check("app mounts", rootHtml.length > 200, `root had ${rootHtml.length} chars`);
  check("no console errors on boot", errors.length===0, errors.slice(0,3).join(" | "));
  check("welcome screen renders", await page.getByText("NOT JUST A").isVisible().catch(()=>false));
  const release = await page.evaluate(()=>CURRENT_RELEASE);
  check("release manifest has versioned change notes", /^\d+\.\d+\.\d+$/.test(release?.version||"") && release?.changes?.length>=1, JSON.stringify(release));
  check("fresh installs do not get an update popup during onboarding", !/WHAT'S NEW/.test(await page.locator("body").innerText()));

  console.log("\n── ONBOARDING (no key) ──────────────────────────");
  await page.getByText("LET'S GO").click();
  await page.waitForTimeout(300);
  check("goal step", await page.getByText("WHAT ARE YOU AFTER?").isVisible().catch(()=>false));
  await page.getByText("Build muscle", {exact:false}).first().click();
  await page.waitForTimeout(150);

  /* v2.1 regression: a component defined inside Onboarding was recreated on
     every render, so React remounted the step and the focused input was
     destroyed — one character then the keyboard closed. A single-character test
     cannot see this, which is exactly how it shipped. */
  console.log("\n── TYPING (the one-character bug) ───────────────");
  const PHRASE = "keep up with my kids without getting winded";
  const why = page.locator('textarea[placeholder*="keep up with my kids"]');
  await why.click();
  for(const ch of PHRASE){ await why.press(ch === " " ? "Space" : ch); }
  await page.waitForTimeout(200);
  check("full phrase survives typing", (await why.inputValue()) === PHRASE,
    `got ${JSON.stringify(await why.inputValue())}`);
  check("field still has focus after typing",
    await page.evaluate(()=>document.activeElement?.tagName?.toLowerCase()) === "textarea");

  const target = page.locator('input[type="number"]').first();
  await target.click();
  for(const ch of "84"){ await target.press(ch); }
  await page.waitForTimeout(150);
  check("numeric field takes multiple digits", (await target.inputValue()) === "84",
    `got ${JSON.stringify(await target.inputValue())}`);

  await page.getByText("NEXT →").click();
  await page.waitForTimeout(300);
  check("profile step", await page.getByText("ABOUT YOU").isVisible().catch(()=>false));
  await page.getByText("NEXT →").click();
  await page.waitForTimeout(300);
  check("limits step", await page.getByText("ANYTHING SORE?").isVisible().catch(()=>false));
  await page.getByText("NEXT →").click();
  await page.waitForTimeout(300);
  check("equipment step", await page.getByText("YOUR GYM").first().isVisible().catch(()=>false));
  await page.getByText("NEXT →").click();
  await page.waitForTimeout(300);
  check("key step", await page.getByText("TURN ON THE COACH").isVisible().catch(()=>false));

  await page.getByText("BUILD MY PLAN").click();
  await page.waitForTimeout(2500);

  console.log("\n── NO-KEY PATH ──────────────────────────────────");
  const bodyText = await page.locator("body").innerText();
  check("reaches the Today workout cockpit", /YOUR NEXT WORKOUT/i.test(bodyText), bodyText.slice(0,250));
  check("cockpit previews the existing plan before check-in",
    /PLANNED TIME/.test(bodyText) && /EXERCISES/.test(bodyText) && /WORKING SETS/.test(bodyText),
    bodyText.slice(0,500));
  check("no errors through onboarding", errors.length===0, errors.slice(0,3).join(" | "));

  /* The away gym, on the path that needs no API key. The photo path can't run
     here — there's no real vision call — but the by-hand path is the one that
     has to work in a hotel basement with no signal, so it's the one that gets
     driven through the real UI. */
  console.log("\n── AWAY GYM BY HAND (no key) ────────────────────");
  check("venue row sits above the check-in", /Your usual gym/.test(bodyText), bodyText.slice(0,200));
  await page.getByText("Your usual gym").click();
  await page.waitForTimeout(400);
  let vt = await page.locator("body").innerText();
  check("venue sheet opens", /WHERE ARE YOU TRAINING/.test(vt), vt.slice(0,300));
  check("photo or description path is offered", /Photograph or describe it/.test(vt));
  check("photo or description path explains it needs a key", /Needs an API key to interpret photos or free text/.test(vt), vt.slice(0,600));

  await page.getByText("✋ Pick by hand").click();
  await page.waitForTimeout(400);
  vt = await page.locator("body").innerText();
  check("by-hand step opens", /WHAT'S IN THERE/.test(vt), vt.slice(0,300));
  check("presets offered", /Dumbbells and a bench/.test(vt));

  // Nothing ticked yet, so it must refuse to apply rather than build an
  // impossible session.
  const applyBtn = page.getByText("TRAIN HERE TODAY").first();
  check("cannot apply an empty gym", await applyBtn.isDisabled().catch(()=>false));

  await page.getByText("Dumbbells and a bench").first().click();
  await page.waitForTimeout(350);
  vt = await page.locator("body").innerText();
  check("preset reports how much it can build", /exercises available here/.test(vt), vt.slice(0,400));
  check("preset is honest about what's missing", /Missing:|Every main movement pattern/.test(vt));
  check("away flow offers a standalone program pause", /Pause program · build one day/.test(vt));
  check("away flow can still adapt the next programmed workout", /Continue program · adapt next workout/.test(vt));
  await page.getByText("Continue program · adapt next workout", {exact:true}).click();

  const dbField = page.locator('input[inputmode="decimal"]').last();
  await dbField.click();
  for(const ch of "15"){ await dbField.press(ch); }
  await page.waitForTimeout(150);
  check("dumbbell ceiling takes typing", (await dbField.inputValue()) === "15",
    `got "${await dbField.inputValue()}"`);

  await applyBtn.click();
  await page.waitForTimeout(600);
  vt = await page.locator("body").innerText();
  check("away gym now shown on Today", /Dumbbells and a bench/.test(vt), vt.slice(0,300));
  check("away gym says the next workout is adapted", /next workout adapted/.test(vt));
  const travel = await page.evaluate(()=>JSON.parse(localStorage.getItem("snapfit_v2")).travel);
  check("away gym persisted and active", travel?.active === true, JSON.stringify(travel));
  check("dumbbell ceiling stored", travel?.dumbbellMax === 15, `got ${travel?.dumbbellMax}`);
  check("home gym left untouched", (await page.evaluate(
    ()=>JSON.parse(localStorage.getItem("snapfit_v2")).equipment.enabled.length)) > 20);

  await buildTodaySession(page);
  await page.waitForTimeout(2500);
  const awayText = await page.locator("body").innerText();
  check("session built at the away gym",
    await activeExerciseCount(page) >= 2,
    awayText.slice(0,300));
  check("venue chip on the session", /📍 Dumbbells and a bench/.test(awayText), awayText.slice(0,400));
  await page.getByRole("button", {name:"Open today's brief", exact:true}).click();
  await page.getByRole("button", {name:"Fold today's brief", exact:true}).waitFor();
  const awayBriefText = await page.locator("body").innerText();
  check("brief explains the venue", /not your usual gym/.test(awayBriefText), awayBriefText.slice(0,900));

  /* The real test of the feature: only equipment that exists got programmed. */
  const allowed = new Set(["29","25","26"]);
  const awayEx = await page.evaluate(()=>{
    const s = JSON.parse(localStorage.getItem("snapfit_v2_active")||"null");
    return s ? s.exercises.map(e=>({name:e.name, stations:e.stations, weight:e.weight})) : null;
  });
  check("away session readable", Array.isArray(awayEx) && awayEx.length >= 2,
    `got ${awayEx ? awayEx.length : "null"}`);
  check("only away-gym stations programmed",
    awayEx.every(e=>(e.stations||[]).every(n=>allowed.has(n))),
    awayEx.map(e=>`${e.name}@${(e.stations||[]).join("+")}`).join(", "));
  check("nothing prescribed above the dumbbell ceiling",
    awayEx.every(e=>e.weight <= 15), awayEx.map(e=>`${e.name} ${e.weight}kg`).join(", "));
  console.log("     away session: " + awayEx.map(e=>`${e.name} ${e.weight}kg`).join(" · "));

  // Back home. The session built for the hotel must not survive the switch.
  await page.locator("text=⚙").click();
  await page.waitForTimeout(500);
  vt = await page.locator("body").innerText();
  check("settings shows the away gym", /AWAY GYM/.test(vt), vt.slice(0,400));
  check("settings marks it active", /ACTIVE TODAY/.test(vt));
  await page.getByText("BACK TO MY USUAL GYM").click();
  await page.waitForTimeout(400);
  await page.getByText("TODAY", {exact:true}).last().click();
  await page.waitForTimeout(700);
  vt = await page.locator("body").innerText();
  check("back on the usual gym", /Your usual gym/.test(vt), vt.slice(0,300));
  check("hotel session discarded on venue change", /YOUR NEXT WORKOUT/i.test(vt), vt.slice(0,300));
  const cleared = await page.evaluate(()=>JSON.parse(localStorage.getItem("snapfit_v2")).travel);
  check("away gym deactivated but remembered", cleared && cleared.active===false, JSON.stringify(cleared));

  /* A four-night stay should be one tap a day, not a rescan a day — so a
     remembered gym offers itself back rather than making you start over. */
  await page.getByText("Your usual gym").click();
  await page.waitForTimeout(400);
  vt = await page.locator("body").innerText();
  check("a remembered gym offers itself back", /TRAINING AWAY AGAIN/.test(vt), vt.slice(0,300));
  check("reuse says why it's switched off", /different day/.test(vt));
  check("reuse offers somewhere new too", /Somewhere new/.test(vt));
  await page.getByText(/USE .* TODAY/).click();
  await page.waitForTimeout(500);
  const reused = await page.evaluate(()=>JSON.parse(localStorage.getItem("snapfit_v2")).travel);
  check("reuse reactivates without a rescan", reused?.active===true, JSON.stringify(reused));
  check("reuse keeps the same equipment", reused.stations.slice().sort().join(",")==="25,26,29",
    reused.stations.join(","));
  check("reuse keeps the dumbbell ceiling", reused.dumbbellMax===15, `got ${reused.dumbbellMax}`);
  const browserToday=await page.evaluate(()=>todayISO());
  check("reuse stamps today's date", reused.date === browserToday, reused.date);

  // And forget it entirely, so the row goes back to the plain home-gym state.
  await page.getByText("Your usual gym", {exact:false}).click().catch(()=>{});
  await page.waitForTimeout(300);
  await page.getByText("Dumbbells and a bench").first().click();
  await page.waitForTimeout(400);
  vt = await page.locator("body").innerText();
  check("an active away gym can be dropped from the sheet", /BACK TO MY USUAL GYM/.test(vt), vt.slice(0,400));
  await page.getByText("BACK TO MY USUAL GYM").click();
  await page.waitForTimeout(500);

  /* "Forget it" has to actually forget, or the venue keeps offering itself back
     every day after a trip you've finished. */
  await page.getByText("Your usual gym").click();
  await page.waitForTimeout(400);
  await page.getByText("Forget it").click();
  await page.waitForTimeout(500);
  const forgotten = await page.evaluate(()=>JSON.parse(localStorage.getItem("snapfit_v2")).travel);
  check("forget it removes the venue entirely", forgotten === null, JSON.stringify(forgotten));
  await page.getByText("Your usual gym").click();
  await page.waitForTimeout(400);
  vt = await page.locator("body").innerText();
  check("a forgotten venue stops offering itself", /WHERE ARE YOU TRAINING/.test(vt), vt.slice(0,250));
  await page.locator("text=✕").last().click();
  await page.waitForTimeout(400);

  await buildTodaySession(page);
  await page.waitForTimeout(2500);

  const sessText = await page.locator("body").innerText();
  const plannedExerciseCount = await activeExerciseCount(page);
  const exerciseHeaders = page.locator('button[aria-label$=" exercise details"]');
  const exerciseCount = await exerciseHeaders.count();
  check("session generated", plannedExerciseCount >= 3, `found ${plannedExerciseCount} exercises`);
  check("Focus mode starts selected",
    (await page.getByRole("tab", {name:"Focus mode"}).getAttribute("aria-selected")) === "true");
  check("Focus mode shows one exercise at a time", exerciseCount === 1, `rendered ${exerciseCount} exercise cards`);
  check("focused exercise exposes the logging controls",
    /COACH SAYS/.test(sessText) && /SET 1/.test(sessText) && /LOG SET 1/.test(sessText), sessText.slice(0,700));

  console.log("\n── BRIEF & PRESCRIPTION ─────────────────────────");
  check("today's brief is present but folded", /TODAY'S BRIEF/.test(sessText)
    && !/What's required/.test(sessText), sessText.slice(0,500));
  await page.getByRole("button", {name:"Open today's brief", exact:true}).click();
  await page.getByRole("button", {name:"Fold today's brief", exact:true}).waitFor();
  const briefText = await page.locator("body").innerText();
  check("brief says what's required", /What's required/.test(briefText));
  check("brief sets a standard", /The standard/.test(briefText));

  await page.getByRole("tab", {name:"All exercises", exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('[role="tab"]')]
    .some(x=>x.textContent?.trim()==="All exercises" && x.getAttribute("aria-selected")==="true"));
  const overviewHeaders = page.locator('button[aria-label$=" exercise details"]');
  const overviewCount = await overviewHeaders.count();
  check("All exercises shows the complete workout", overviewCount === plannedExerciseCount,
    `${overviewCount} cards vs ${plannedExerciseCount} planned`);
  check("overview exercise details start hidden",
    (await overviewHeaders.evaluateAll(btns=>btns.every(b=>b.getAttribute("aria-expanded")==="false")))
      && await page.getByText("SET 1", {exact:true}).count()===0);
  check("compact exercise invites a tap", /OPEN/.test(await page.locator("body").innerText()));

  await overviewHeaders.first().click();
  await page.waitForTimeout(250);
  const expandedText = await page.locator("body").innerText();
  check("tap reveals coach and logging details",
    /COACH SAYS/.test(expandedText) && /SET 1/.test(expandedText)
      && /Why this\?/.test(expandedText) && /How to do it/.test(expandedText),
    expandedText.slice(0,600));
  check("prescription row present", /COACH SAYS/.test(expandedText));
  const coachRows = await page.getByText("COACH SAYS", {exact:true}).count();
  check("only the opened exercise reveals its prescription", coachRows === 1, `${coachRows} rows visible`);
  // The brief must not push the first exercise off the screen entirely.
  const firstCardTop = await page.locator("text=COACH SAYS").first().evaluate(el=>el.getBoundingClientRect().top);
  check("first exercise reachable without a long scroll", firstCardTop < 1400, `top at ${Math.round(firstCardTop)}px`);

  console.log("\n── LOGGING A SET ────────────────────────────────");
  const prescribed = Number((expandedText.match(/COACH SAYS\s*\n?\s*([\d.]+)kg/) || [])[1]);
  await page.getByRole("button", {name:/SET 1 tap to log/}).first().click();
  await page.getByText("REPS COMPLETED", {exact:true}).waitFor();
  check("rep picker opens", /REPS COMPLETED/.test(await page.locator("body").innerText()));
  let pickerText=await page.locator("body").innerText();
  check("set entry shows recent loads by default", /LAST 3 SESSIONS · WORKING LOAD/.test(pickerText));
  check("set entry shows prescribed and actual loads side by side", /PRESCRIBED/.test(pickerText)&&/ACTUAL/.test(pickerText));

  // Free-text weight: type it rather than tapping the stepper eleven times.
  const wField = page.locator('input[inputmode="decimal"]').first();
  await wField.click();
  await wField.fill("");
  for(const ch of "47.5"){ await wField.press(ch === "." ? "Period" : ch); }
  await wField.press("Enter");
  await page.waitForTimeout(250);
  check("typed weight commits", (await wField.inputValue()) === "47.5",
    `got ${JSON.stringify(await wField.inputValue())}`);

  await page.getByText("RATE REPS IN RESERVE").click();
  await page.waitForTimeout(300);
  check("RIR step asks a numeric programming question", /HOW MANY MORE CLEAN REPS COULD YOU HAVE DONE/.test(await page.locator("body").innerText()));
  check("RIR step shows the typed weight", /47\.5kg/.test(await page.locator("body").innerText()));
  await page.getByText("2 RIR", {exact:true}).click();
  await page.waitForTimeout(200);
  await page.getByText("LOG IT").click();
  await page.waitForTimeout(600);
  let t2 = await page.locator("body").innerText();
  check("set logged", /1 of \d+ sets logged/.test(t2));
  check("rest timer appeared", /REST/.test(t2));
  check("post-set trainer appears after logging", /YOUR TRAINER/.test(t2) && /WHY/.test(t2) && /NEXT-SET CUE/.test(t2));
  check("post-set trainer gives an actionable target", /Next set:/.test(t2) && /USE [\d.]+KG · AIM \d+/.test(t2));
  check("post-set trainer flags actual versus prescribed load", /ACTUAL [\d.]+KG (BELOW|ABOVE) PRESCRIBED/.test(t2));
  const writeThrough=await page.evaluate(()=>{
    const s=JSON.parse(localStorage.getItem("snapfit_v2_active")||"null");
    return s?.exercises?.[0]?.log?.[0]||null;
  });
  check("the set is written through immediately with numeric RIR", writeThrough?.weight===47.5&&writeThrough?.rir===2,JSON.stringify(writeThrough));

  const useTarget = page.getByText(/USE [\d.]+KG · AIM \d+/).first();
  const useLabel = await useTarget.innerText();
  const coachedWeight = String(useLabel).match(/USE ([\d.]+)KG/)?.[1];
  await useTarget.click();
  await page.waitForTimeout(300);

  console.log("\n── PRESCRIPTION VS REALITY ──────────────────────");
  check("prescription unchanged after an override",
    new RegExp(`COACH SAYS\\s*\\n?\\s*${prescribed}kg`).test(t2), `expected ${prescribed}kg still shown`);
  check("gap from the plan is called out", /You're [\d.]+kg (under|over) that/.test(t2), t2.slice(0,400));

  console.log("\n── WEIGHT CARRIES TO THE NEXT SET ───────────────");
  await page.getByText("SET 2", {exact:true}).first().click();
  await page.waitForTimeout(400);
  const w2 = page.locator('input[inputmode="decimal"]').first();
  check("set 2 offers the accepted trainer target", (await w2.inputValue()) === coachedWeight,
    `expected ${coachedWeight}, got ${JSON.stringify(await w2.inputValue())}`);
  check("and still shows prescription beside actual",
    /PRESCRIBED/.test(await page.locator("body").innerText())&&/ACTUAL/.test(await page.locator("body").innerText()));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  if(await page.getByText("REPS COMPLETED").isVisible().catch(()=>false)){
    await page.mouse.click(5,5); await page.waitForTimeout(300);
  }

  console.log("\n── TIMER SURVIVES NAVIGATION ────────────────────");
  const readRest = () => page.evaluate(()=>{
    try{ return JSON.parse(localStorage.getItem("snapfit_v2_rest")||"null"); }catch{ return null; }
  });
  const restBefore = await readRest();
  check("rest persisted with a wall-clock end", !!restBefore?.endsAt, JSON.stringify(restBefore));
  await page.getByRole("button", {name:"Open Learn"}).click();
  await page.waitForTimeout(1200);
  check("timer still visible on another tab", /REST|GO/.test(await page.locator("body").innerText()));
  await page.getByText("TODAY", {exact:true}).last().click();
  await page.waitForTimeout(400);
  check("same countdown, not restarted", (await readRest())?.endsAt === restBefore.endsAt);

  console.log("\n── TIMER SURVIVES RELOAD ────────────────────────");
  await page.reload({waitUntil:"networkidle"});
  await page.waitForTimeout(2000);
  check("timer resumed after reload", /REST|GO/.test(await page.locator("body").innerText()));
  check("endsAt unchanged by the reload", (await readRest())?.endsAt === restBefore.endsAt);
  await page.getByText(/SKIP|OK/).first().click();
  await page.waitForTimeout(400);
  check("skip clears it", (await readRest()) === null);

  await page.evaluate(()=>{
    const s = JSON.parse(localStorage.getItem("snapfit_v2_active")||"null");
    if(!s?.exercises?.length) return;
    const ex = s.exercises[0];
    ex.log = Array.from({length:ex.sets}, (_,i)=>ex.log?.[i] || ({
      reps:ex.targetReps, weight:ex.weight, effort:"good"
    }));
    localStorage.setItem("snapfit_v2_active", JSON.stringify(s));
  });
  await page.reload({waitUntil:"networkidle"});
  await page.waitForTimeout(1200);
  await page.getByRole("tab", {name:"All exercises", exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('[role="tab"]')]
    .some(x=>x.textContent?.trim()==="All exercises" && x.getAttribute("aria-selected")==="true"));
  const completeHeader = page.locator('button[aria-label$=" exercise details"]').first();
  check("completed exercise is collapsed", /COMPLETE/.test(await completeHeader.innerText())
    && (await completeHeader.getAttribute("aria-expanded")) === "false");
  const cardBackgrounds = await page.locator('button[aria-label$=" exercise details"]').evaluateAll(btns=>
    btns.slice(0,2).map(b=>getComputedStyle(b.parentElement).backgroundColor));
  check("completed exercise gets a light green background",
    cardBackgrounds.length > 1 && cardBackgrounds[0] !== cardBackgrounds[1], JSON.stringify(cardBackgrounds));

  console.log("\n── FORM COACHING ────────────────────────────────");
  await completeHeader.click();
  await page.waitForTimeout(250);
  await page.getByText("How to do it").first().click();
  await page.waitForTimeout(600);
  const howText = await page.locator("body").innerText();
  check("cues render", /SET UP/.test(howText) && /COMMON MISTAKES/.test(howText), howText.slice(0,200));
  const videoLink = page.getByRole("link", {name:/Search YouTube Shorts/}).first();
  const videoHref = await videoLink.getAttribute("href");
  check("how-to offers a credit-free YouTube Shorts search",
    /youtube\.com\/results\?search_query=/.test(videoHref||"") && /technique/.test(videoHref||""), videoHref);

  console.log("\n── FINISH & DEBRIEF ─────────────────────────────");
  await page.getByText("FINISH SESSION").click();
  await page.getByText("WHY WAS WORK LEFT?", {exact:true}).waitFor();
  check("partial session distinguishes couldn't from didn't", /external constraint|I stopped/i.test(await page.locator("body").innerText()));
  await page.getByText("No external constraint — I stopped", {exact:true}).click();
  await page.getByText("SAVE PARTIAL SESSION", {exact:false}).click();
  await page.waitForTimeout(2500);
  const dbText = await page.locator("body").innerText();
  check("debrief renders", /SESSION DONE/.test(dbText), dbText.slice(0,200));
  check("debrief has progression rows", /WHAT MOVES NEXT TIME/.test(dbText));
  const ttsSupported = await page.evaluate(()=>"speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
  check("debrief offers a voice summary when speech is supported", !ttsSupported || /Listen/.test(dbText));
  await page.getByText("DONE", {exact:true}).click();
  await page.waitForTimeout(600);

  console.log("\n── OPTIONAL EXTRA SESSION ───────────────────────");
  await page.getByText("PLAN", {exact:true}).last().click();
  await page.waitForTimeout(400);
  let planText = await page.locator("body").innerText();
  check("Plan offers an extra-session button", /ADD AN EXTRA SESSION/.test(planText), planText.slice(-500));
  const progressBeforeExtra = await page.evaluate(()=>{
    const st = JSON.parse(localStorage.getItem("snapfit_v2"));
    const p = blockProgress(st);
    return {done:p.done,dayIdx:p.dayIdx,phaseRpe:p.phase.rpe,
      expectedDay:(SPLITS[p.dpw]||SPLITS[3])[p.dayIdx].name};
  });
  await page.getByText("ADD AN EXTRA SESSION +", {exact:true}).click();
  await page.waitForTimeout(350);
  const extraGate = await page.locator("body").innerText();
  check("extra session gets its own check-in",
    /EXTRA SESSION/.test(extraGate) && /next workout in your existing rotation/i.test(extraGate)
      && /weekly target stays the same/i.test(extraGate), extraGate.slice(0,650));
  await page.getByText("Skip answers — use normal readiness", {exact:true}).click();
  await page.waitForTimeout(900);
  const generatedExtra = await page.evaluate(()=>{
    const sess = JSON.parse(localStorage.getItem("snapfit_v2_active")||"null");
    const st = JSON.parse(localStorage.getItem("snapfit_v2"));
    const p = blockProgress(st);
    return {bonus:sess?.bonus,dayName:sess?.dayName,rpes:(sess?.exercises||[]).map(e=>e.rpe),done:p.done,dayIdx:p.dayIdx};
  });
  check("generated extra session follows the current plan",
    generatedExtra.bonus===true && generatedExtra.dayName===progressBeforeExtra.expectedDay
      && generatedExtra.rpes.every(r=>r===progressBeforeExtra.phaseRpe), JSON.stringify(generatedExtra));
  check("building the extra session leaves plan progress alone",
    generatedExtra.done===progressBeforeExtra.done && generatedExtra.dayIdx===progressBeforeExtra.dayIdx,
    JSON.stringify({before:progressBeforeExtra,after:generatedExtra}));
  await page.getByText("ABANDON", {exact:true}).click();
  await page.waitForTimeout(250);
  await page.getByText("Abandon", {exact:true}).click();
  await page.waitForTimeout(400);

  console.log("\n── PRIMARY NAVIGATION ───────────────────────────");
  for(const [label, expect] of [["Today","YOUR NEXT WORKOUT"],["Plan","YOUR BLOCK"],
                                 ["Progress","PROGRESS"],["Coach","COACH"]]){
    await page.getByRole("button", {name:label, exact:true}).click();
    await page.waitForTimeout(500);
    const t = await page.locator("body").innerText();
    check(`${label} tab renders`, t.includes(expect), t.slice(0,150));
  }

  await page.getByRole("button", {name:"Progress", exact:true}).click();
  await page.getByRole("tab", {name:"Goal", exact:true}).click();
  check("Goal lives inside Progress", /YOUR GOAL/.test(await page.locator("body").innerText()));
  await page.getByRole("tab", {name:"History", exact:true}).click();
  check("workout history lives inside Progress", /LOG/.test(await page.locator("body").innerText()));

  console.log("\n── LEARN TOPIC + QUIZ ───────────────────────────");
  await page.getByRole("button", {name:"Open Learn"}).click();
  await page.waitForTimeout(400);
  await page.getByText("Progressive overload").first().click();
  await page.waitForTimeout(500);
  const lt = await page.locator("body").innerText();
  check("topic body renders", /QUICK CHECK/.test(lt), lt.slice(0,200));
  await page.getByText("Add weight and expect fewer reps").click();
  await page.waitForTimeout(400);
  check("quiz answers", /top of the range/.test(await page.locator("body").innerText()));
  await page.getByText("MARK AS READ").click();
  await page.waitForTimeout(400);
  check("read tracked", /1 of \d+ topics covered/.test(await page.locator("body").innerText()));

  console.log("\n── CHAT WITHOUT KEY ─────────────────────────────");
  await page.getByText("COACH", {exact:true}).last().click();
  await page.waitForTimeout(400);
  check("chat prompts for key", /ADD A KEY IN SETTINGS/.test(await page.locator("body").innerText()));

  console.log("\n── SETTINGS ─────────────────────────────────────");
  await page.locator("text=⚙").click();
  await page.waitForTimeout(500);
  const st = await page.locator("body").innerText();
  check("settings renders", /SETTINGS/.test(st));
  check("key warning present", /Stored unencrypted/.test(st));
  check("equipment editor present", /YOUR GYM/.test(st));
  check("text size editor present", /text size/i.test(st));
  check("sound toggle present", /Rest timer sounds/.test(st));
  check("timer volume control present", /timer volume/i.test(st));
  check("wake lock toggle present", /Keep the screen awake/.test(st));
  check("test whistles button present", /Test countdown \+ long whistle/.test(st));
  check("settings can reopen release notes", st.includes(`What's new in ${release.version}`));
  await page.getByText(`What's new in ${release.version}`, {exact:false}).click();
  await page.waitForTimeout(250);
  const whatsNew = await page.locator("body").innerText();
  check("What's New modal outlines the release", /WHAT'S NEW/.test(whatsNew)
    && /numeric RIR/i.test(whatsNew) && /estimated 1RM trend lines/i.test(whatsNew), whatsNew.slice(-900));
  await page.getByText(/LET'S TRAIN|CONTINUE WORKOUT/).click();
  await page.waitForTimeout(200);
  await page.evaluate(()=>localStorage.setItem("snapfit_v2_release_seen","2.1.0"));
  await page.reload();
  await page.waitForTimeout(700);
  const automaticNotes=await page.locator("body").innerText();
  check("an existing install sees release notes once after an update",
    /WHAT'S NEW/.test(automaticNotes) && automaticNotes.includes(`SNAPFIT ${release.version}`));
  const activeAtUpdate=await page.evaluate(()=>!!localStorage.getItem("snapfit_v2_active"));
  check("update notes reflect whether a workout is active",
    /active workout was preserved/i.test(automaticNotes) === activeAtUpdate);
  await page.getByText(/CONTINUE WORKOUT|LET'S TRAIN/).click();
  await page.waitForTimeout(200);
  await page.getByRole("button", {name:"Open Settings", exact:true}).click();
  await page.waitForTimeout(300);

  const scheduleBefore = await page.evaluate(()=>{
    const s=JSON.parse(localStorage.getItem("snapfit_v2")), p=blockProgress(s);
    return {id:s.block.id,week:p.week,phase:p.phase.name,done:p.done};
  });
  const daysField = page.getByText(/DAYS PER WEEK — 3/i).first().locator("..");
  await daysField.locator('input[type="range"]').fill("4");
  await page.waitForTimeout(300);
  const scheduleAfter = await page.evaluate(()=>{
    const s=JSON.parse(localStorage.getItem("snapfit_v2")), p=blockProgress(s);
    return {id:s.block.id,week:p.week,phase:p.phase.name,done:p.done,dpw:p.dpw};
  });
  check("changing weekly frequency keeps the same block",
    scheduleAfter.id===scheduleBefore.id && scheduleAfter.done===scheduleBefore.done,
    JSON.stringify({before:scheduleBefore,after:scheduleAfter}));
  check("changing weekly frequency preserves week and phase",
    scheduleAfter.week===scheduleBefore.week && scheduleAfter.phase===scheduleBefore.phase && scheduleAfter.dpw===4,
    JSON.stringify({before:scheduleBefore,after:scheduleAfter}));

  console.log("\n── THEME ────────────────────────────────────────");

  /* Read the palette that's actually in force, plus real computed colours off
     real elements, so a token defined but never applied still fails. */
  const readTheme = () => page.evaluate(()=>{
    const cs = getComputedStyle(document.documentElement);
    const v = n => cs.getPropertyValue(n).trim();
    const tokens = {};
    for(const n of ["bg","surface","card","raised","line","lineSoft","text","dim","faint","ghost",
                    "red","redSoft","green","blue","yellow","orange","purple","greenDeep","onGreen"]){
      tokens[n] = v("--c-"+n);
    }
    // Does color-mix actually resolve? An unsupported value would compute to
    // nothing and every tinted border in the app would silently vanish.
    const probe = document.createElement("div");
    probe.style.background = `color-mix(in srgb, ${v("--c-red")} 33.3%, transparent)`;
    document.body.appendChild(probe);
    const mixed = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const h2 = document.querySelector("h2");
    return {
      attr: document.documentElement.dataset.theme,
      tokens,
      mixed,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      headingColor: h2 ? getComputedStyle(h2).color : null,
      meta: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
      bar: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute("content"),
    };
  });

  /* Every colour the app draws with, checked against the surface it sits on.
     Accents are held to 3:1 (WCAG 1.4.11 — they're chips, borders, big display
     numbers and labels, not body copy); text and dim to the body-copy bar. */
  function auditTheme(t, label){
    const { tokens } = t;
    const ACCENTS = ["red","green","blue","yellow","orange","purple"];
    const textR = contrast(tokens.text, tokens.card);
    const dimR  = contrast(tokens.dim,  tokens.card);
    const accR  = ACCENTS.map(k=>[k, contrast(tokens[k], tokens.card)]);
    const worst = Math.min(...accR.map(([,r])=>r));
    check(`${label}: colour-mix resolves to a real colour`,
      /^(rgba?|color)\(/.test(t.mixed) && !/^rgba\(0, 0, 0, 0\)$/.test(t.mixed), t.mixed);
    check(`${label}: body background uses the theme's bg`,
      contrast(t.bodyBg, tokens.bg) < 1.02, `${t.bodyBg} vs ${tokens.bg}`);
    check(`${label}: body text ≥ 7:1`, textR >= 7, `${textR.toFixed(2)}:1`);
    check(`${label}: secondary text ≥ 4.5:1`, dimR >= 4.5, `${dimR.toFixed(2)}:1`);
    for(const [k,r] of accR) check(`${label}: ${k} ≥ 3:1 on card`, r >= 3, `${r.toFixed(2)}:1`);
    console.log(`     ${label}: text ${textR.toFixed(1)}:1 · dim ${dimR.toFixed(1)}:1 · ` +
      accR.map(([k,r])=>`${k} ${r.toFixed(1)}`).join(" · "));
    return { worst, textR };
  }

  // Start from an explicit choice so this doesn't depend on the runner's OS.
  const themeBtns = page.locator("text=Theme").locator("..").locator("button");
  await themeBtns.nth(2).click();                       // Dark
  await page.waitForTimeout(400);
  const darkT = await readTheme();
  check("dark applies", darkT.attr === "dark", darkT.attr);
  check("dark meta theme-color", darkT.meta === "#0e0e0e", String(darkT.meta));
  check("dark iOS status bar style", darkT.bar === "black", String(darkT.bar));
  const darkAudit = auditTheme(darkT, "dark ");

  await themeBtns.nth(1).click();                       // Light
  await page.waitForTimeout(400);
  const lightT = await readTheme();
  check("light applies", lightT.attr === "light", lightT.attr);
  check("light actually repaints the page", lightT.bodyBg !== darkT.bodyBg,
    `${darkT.bodyBg} → ${lightT.bodyBg}`);
  check("light meta theme-color", lightT.meta === "#edeae5", String(lightT.meta));
  check("light iOS status bar style", lightT.bar === "default", String(lightT.bar));
  check("light inverts the text", luminance(lightT.tokens.text) < luminance(darkT.tokens.text),
    `${lightT.tokens.text} vs ${darkT.tokens.text}`);
  check("light darkens every accent", ["red","green","blue","yellow","orange","purple"]
    .every(k=>luminance(lightT.tokens[k]) < luminance(darkT.tokens[k])),
    ["red","green","blue","yellow","orange","purple"].map(k=>`${k}:${lightT.tokens[k]}`).join(" "));
  check("light flips onGreen so button text stays legible",
    luminance(lightT.tokens.onGreen) > luminance(darkT.tokens.onGreen),
    `${darkT.tokens.onGreen} → ${lightT.tokens.onGreen}`);
  const lightAudit = auditTheme(lightT, "light");

  /* The check that matters: light must not be the weaker theme. Dark's bright
     accents on near-black run very high, so per-token parity is the wrong bar —
     what counts is that light's worst point beats dark's worst point. */
  check("light's weakest accent beats dark's weakest",
    lightAudit.worst >= darkAudit.worst,
    `light ${lightAudit.worst.toFixed(2)}:1 vs dark ${darkAudit.worst.toFixed(2)}:1`);

  /* faint and ghost carry hints and warnings — including the API-key one — and
     neither theme gets them to 4.5:1. Hold light to beating dark instead, which
     is the guarantee that actually matters: the new theme is never the weaker
     one for the text that's already hardest to read. */
  for(const k of ["faint","ghost","dim"]){
    const d = contrast(darkT.tokens[k],  darkT.tokens.card);
    const l = contrast(lightT.tokens[k], lightT.tokens.card);
    check(`light's ${k} text is no weaker than dark's`, l >= d,
      `light ${l.toFixed(2)}:1 vs dark ${d.toFixed(2)}:1`);
  }

  // Headings are Bebas display type and must stay readable in both.
  check("headings are readable in light",
    contrast(lightT.headingColor, lightT.tokens.bg) >= 4.5,
    `${contrast(lightT.headingColor, lightT.tokens.bg).toFixed(2)}:1`);

  check("choice persisted to storage",
    (await page.evaluate(()=>localStorage.getItem("snapfit_v2_theme"))) === "light");
  await page.reload({waitUntil:"networkidle"});
  await page.waitForTimeout(1800);
  check("theme survives a reload",
    (await page.evaluate(()=>document.documentElement.dataset.theme)) === "light");

  /* System has to mean system continuously, not "system as of app start". */
  console.log("\n── SYSTEM THEME FOLLOWS THE PHONE ───────────────");
  await page.evaluate(()=>localStorage.setItem("snapfit_v2_theme","system"));
  await page.emulateMedia({colorScheme:"dark"});
  await page.reload({waitUntil:"networkidle"});
  await page.waitForTimeout(1800);
  check("system resolves to dark on a dark phone",
    (await page.evaluate(()=>document.documentElement.dataset.theme)) === "dark");
  await page.emulateMedia({colorScheme:"light"});
  await page.waitForTimeout(500);
  check("and follows the phone flipping, with no reload",
    (await page.evaluate(()=>document.documentElement.dataset.theme)) === "light");
  await page.emulateMedia({colorScheme:"dark"});
  await page.waitForTimeout(500);
  check("and back again",
    (await page.evaluate(()=>document.documentElement.dataset.theme)) === "dark");

  // An explicit choice must NOT be overridden by the phone switching at sunset.
  await page.evaluate(()=>localStorage.setItem("snapfit_v2_theme","light"));
  await page.reload({waitUntil:"networkidle"});
  await page.waitForTimeout(1800);
  await page.emulateMedia({colorScheme:"dark"});
  await page.waitForTimeout(500);
  check("an explicit choice ignores the phone",
    (await page.evaluate(()=>document.documentElement.dataset.theme)) === "light");
  await page.emulateMedia({colorScheme:null});

  /* The no-flash path: the theme must be settled by the inline <head> script,
     before React exists. Block the libraries and check it still resolves. */
  console.log("\n── THEME BEFORE FIRST PAINT ─────────────────────");
  const bare = await ctx.newPage();
  await bare.route("**/unpkg.com/**", r=>r.abort());
  await bare.addInitScript(()=>localStorage.setItem("snapfit_v2_theme","light"));
  await bare.emulateMedia({colorScheme:"dark"});
  await bare.goto(`http://127.0.0.1:${PORT}/index.html`, {waitUntil:"domcontentloaded"});
  const bareState = await bare.evaluate(()=>({
    theme: document.documentElement.dataset.theme,
    react: typeof window.React,
    bg: getComputedStyle(document.body).backgroundColor,
  }));
  check("theme resolves with React blocked entirely", bareState.theme === "light",
    JSON.stringify(bareState));
  check("no React on that page, so it really was the head script",
    bareState.react === "undefined", bareState.react);
  check("and the background is already painted light",
    luminance(bareState.bg) > 0.5, bareState.bg);
  await bare.close();

  /* Both settings write to documentElement — easy for one to clobber the other. */
  console.log("\n── TEXT SCALE SURVIVES A THEME CHANGE ───────────");
  await page.evaluate(()=>{
    localStorage.setItem("snapfit_v2_theme","dark");
    localStorage.setItem("snapfit_v2_textscale","largest");
  });
  await page.reload({waitUntil:"networkidle"});
  await page.waitForTimeout(1800);
  const both = await page.evaluate(()=>({
    ts: getComputedStyle(document.documentElement).getPropertyValue("--ts").trim(),
    theme: document.documentElement.dataset.theme,
  }));
  check("theme and text scale coexist", both.ts === "1.35" && both.theme === "dark",
    JSON.stringify(both));
  await page.evaluate(()=>localStorage.setItem("snapfit_v2_textscale","comfortable"));
  await page.reload({waitUntil:"networkidle"});
  await page.waitForTimeout(1800);
  await page.locator("text=⚙").click();
  await page.waitForTimeout(600);

  console.log("\n-- COACH PERSONALITY ---------------------------");
  let settingsText = await page.locator("body").innerText();
  check("personality controls render", /SASS.+CHEEKY/i.test(settingsText) && /HARD TRUTH.+BLUNT/i.test(settingsText), settingsText.slice(0,500));
  const personalityRanges = page.locator('input[type="range"]');
  await personalityRanges.nth(0).fill("5");
  await personalityRanges.nth(1).fill("2");
  await page.waitForTimeout(300);
  const storedStyle = await page.evaluate(()=>JSON.parse(localStorage.getItem("snapfit_v2")).coachStyle);
  check("personality choices persist", storedStyle.sass===5 && storedStyle.hardTruth===2, JSON.stringify(storedStyle));
  await page.evaluate(()=>{
    const s=JSON.parse(localStorage.getItem("snapfit_v2"));
    s.coachStyle={sass:3,hardTruth:4};
    localStorage.setItem("snapfit_v2",JSON.stringify(s));
  });
  await page.reload({waitUntil:"networkidle"});
  await page.waitForTimeout(1800);
  await page.locator("text=⚙").click();
  await page.waitForTimeout(600);

  /* A silently invalid style is the failure mode here: `${C.red}55` on a var()
     produces no border and no error. Guard the source itself. */
  console.log("\n── NO HEX-ALPHA CONCATENATION LEFT ──────────────");
  const appSrc = fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
  const leftovers = (appSrc.match(/\$\{[^{}]*\}[0-9a-fA-F]{2}\b/g) || [])
    .filter(s=>!/\}(px|rem|em|vh|vw)/.test(s));
  check("no colour is built by appending hex alpha", leftovers.length===0,
    leftovers.slice(0,4).join(" | "));
  check("tint() is used instead", /function tint\(/.test(appSrc) && /tint\(C\./.test(appSrc));
  check("rest timer does not claim the phone's media session",
    !/new Audio\(|navigator\.mediaSession|silentWav\(/.test(appSrc));
  check("iPhone cues request a mixable ambient audio session",
    /navigator\.audioSession\.type\s*=\s*"ambient"/.test(appSrc));
  check("timer watches for an iPhone audio clock that claims to run but freezes",
    /function armWatchdog\(/.test(appSrc) && /rescheduleActive\(true\)/.test(appSrc));
  check("chat composer follows the iPhone visual viewport above the keyboard",
    /window\.visualViewport/.test(appSrc) && /function ChatComposer\(/.test(appSrc));
  check("chat history is capped before it reaches the API",
    /CHAT_CONTEXT_MESSAGES\s*=\s*8/.test(appSrc) && /messages\.slice\(-CHAT_CONTEXT_MESSAGES\)/.test(appSrc));
  check("training-week start and optional workout help are saved settings",
    /weekStartsOn/.test(appSrc) && /showExerciseWhy/.test(appSrc) && /showExerciseHow/.test(appSrc));
  check("advanced learning is an optional layer",
    /showAdvancedLearn:false/.test(appSrc) && (appSrc.match(/level:"advanced"/g)||[]).length>=4);
  check("primary navigation is Today, Plan, Progress and Coach",
    /const NAV = \[\s*\{id:"today", label:"Today"[\s\S]*\{id:"plan",\s+label:"Plan"[\s\S]*\{id:"progress",label:"Progress"[\s\S]*\{id:"coach", label:"Coach"/.test(appSrc)
      && !/const NAV = \[[\s\S]{0,400}\{id:"(?:goal|log|learn)"/.test(appSrc));
  check("Goal and history are consolidated under Progress",
    /const tabs=\[\["overview","Overview"\],\["goal","Goal"\],\["history","History"\]\]/.test(appSrc));
  check("one-week targets do not replace the global schedule",
    /function setPlanWeekTarget\(/.test(appSrc) && /weekTargets/.test(appSrc));
  check("the current plan week has a non-destructive manual failsafe",
    /function setCurrentPlanWeek\(/.test(appSrc) && /CURRENT BLOCK WEEK FAILSAFE/.test(appSrc) && /LOCK IN WEEK/.test(appSrc));
  check("logged sessions can be reassigned without changing their date",
    /PLAN-WEEK PLACEMENT/.test(appSrc) && /planWeekForSession/.test(appSrc));
  check("a generated session can be rebuilt without advancing the block",
    /Regenerate this session/.test(appSrc) && /function regenerateSession\(/.test(appSrc));
  check("pre-generation questions include time and a coach note",
    /Time available today/.test(appSrc) && /Anything the coach should know/.test(appSrc));
  check("the full floor plan and editable plate loads are present",
    /PLATE_LOADED_DEFAULTS/.test(appSrc) && /EquipmentLoadsView/.test(appSrc) && /Watagan Park plate-loaded machines/.test(appSrc));
  check("the API key is persisted from every supported save path",
    /useEffect\(\(\)=>\{ saveKey\(apiKey\); \},\[apiKey\]\)/.test(appSrc));
  check("a saved API key refreshes automatically without message tokens",
    /API_MODELS_URL/.test(appSrc) && /nextApiCheckDelay\(apiStatus\)/.test(appSrc) && /API_OK_RECHECK_MS/.test(appSrc));
  check("AI fallback is persistent and never presented as an active coach",
    /THIS SESSION IS NOT AI-GENERATED/.test(appSrc) && /COACH OFFLINE/.test(appSrc) && /RETRY AI GENERATION/.test(appSrc));
  check("a failed AI block retry preserves the existing block",
    /previous && keyRef\.current && block\?\.source!=="ai"/.test(appSrc));
  check("the AI receives a whole-journey summary plus detailed recent history",
    /function journeyDigest\(/.test(appSrc) && /WHOLE TRAINING JOURNEY/.test(appSrc) && /function historyDigest\(state, n=8\)/.test(appSrc));
  check("post-session coaching can correct the review",
    /function PostSessionChat\(/.test(appSrc) && /postSessionChatStream/.test(appSrc)
      && /setDebriefSession\(stored\)/.test(appSrc));
  check("Hammer Strength row variants are explicit workout exercises",
    ["Hammer Strength Iso-Lateral Row","Hammer Strength Iso-Lateral High Row","Hammer Strength Iso-Lateral Low Row"]
      .every(name=>appSrc.includes(`name:"${name}"`)));
  check("Glute Drive includes its confirmed base resistance",
    /"36":\{model:"Hammer Strength Plate-Loaded Glute Drive",startKg:20\.4,mode:"total"/.test(appSrc));
  check("long equipment names wrap on the Loads screen",
    /<TextArea rows=\{2\} value=\{cfg\.model\|\|""\}/.test(appSrc)
      && /aria-label=\{`Station \$\{station\} machine model`\}/.test(appSrc));
  check("busy-equipment swaps stay inside the catalogue and do not call AI",
    /function exerciseSwapOptions\(/.test(appSrc) && /Swap exercise \/ flag discomfort/.test(appSrc));
  const swSrc = fs.readFileSync(path.join(ROOT,"sw.js"),"utf8");
  const shortWhistle = path.join(ROOT,"assets","sounds","countdown-whistle.mp3");
  const longWhistle = path.join(ROOT,"assets","sounds","start-whistle.mp3");
  check("short whistle is bundled", fs.existsSync(shortWhistle) && fs.statSync(shortWhistle).size > 1000);
  check("long whistle is bundled", fs.existsSync(longWhistle) && fs.statSync(longWhistle).size > 1000);
  check("both whistles are cached for offline use",
    /assets\/sounds\/countdown-whistle\.mp3/.test(swSrc) && /assets\/sounds\/start-whistle\.mp3/.test(swSrc));
  check("online app launches are network-first before the offline shell",
    /req\.mode === "navigate"/.test(swSrc) && /fetch\(req,\{cache:"no-store"\}\)/.test(swSrc));

  console.log("\n── TEXT SIZE ────────────────────────────────────");
  // Body text scales; the big headings deliberately do not.
  const sizes = async () => page.evaluate(()=>{
    const h = document.querySelector("h2");
    const body = [...document.querySelectorAll("div")]
      .find(d=>/Applies to everything except/.test(d.textContent||"") && d.children.length===0);
    return {
      ts: getComputedStyle(document.documentElement).getPropertyValue("--ts").trim(),
      heading: h ? parseFloat(getComputedStyle(h).fontSize) : null,
      body: body ? parseFloat(getComputedStyle(body).fontSize) : null,
    };
  });
  const beforeSize = await sizes();
  check("default scale is Comfortable", beforeSize.ts === "1.11", `--ts was ${beforeSize.ts}`);

  const aBtns = page.locator("text=Text size").locator("..").locator("button");
  await aBtns.nth(4).click();                 // Largest
  await page.waitForTimeout(400);
  const largest = await sizes();
  check("body text grows", largest.body > beforeSize.body, `${beforeSize.body} → ${largest.body}`);
  check("headings do not", Math.abs(largest.heading - beforeSize.heading) < 0.5,
    `${beforeSize.heading} → ${largest.heading}`);

  await page.getByText("PLAN", {exact:true}).last().click();
  await page.waitForTimeout(350);
  const weekChoiceLayout=async()=>page.locator(".week-session-choice").evaluate(grid=>{
    const outer=grid.getBoundingClientRect();
    const buttons=[...grid.querySelectorAll("button")].map(b=>b.getBoundingClientRect());
    return {
      columns:new Set(buttons.map(r=>Math.round(r.left))).size,
      rows:new Set(buttons.map(r=>Math.round(r.top))).size,
      inside:buttons.every(r=>r.left>=outer.left-1 && r.right<=outer.right+1),
    };
  });
  const largestWeekChoices=await weekChoiceLayout();
  check("Largest text keeps week-session choices inside a two-column grid",
    largestWeekChoices.columns===2 && largestWeekChoices.rows===2 && largestWeekChoices.inside,
    JSON.stringify(largestWeekChoices));
  await page.evaluate(()=>saveScaleId("large"));
  await page.waitForTimeout(150);
  const largeWeekChoices=await weekChoiceLayout();
  check("Large text keeps week-session choices inside a two-column grid",
    largeWeekChoices.columns===2 && largeWeekChoices.rows===2 && largeWeekChoices.inside,
    JSON.stringify(largeWeekChoices));
  await page.evaluate(()=>saveScaleId("largest"));
  await page.locator("text=⚙").click();
  await page.waitForTimeout(350);

  await aBtns.nth(0).click();                 // Compact
  await page.waitForTimeout(400);
  const compact = await sizes();
  check("and shrinks the other way", compact.body < beforeSize.body, `${beforeSize.body} → ${compact.body}`);

  await aBtns.nth(3).click();                 // Large
  await page.waitForTimeout(300);
  await page.reload({waitUntil:"networkidle"});
  await page.waitForTimeout(1800);
  check("choice survives a reload",
    (await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--ts").trim())) === "1.22");
  await page.evaluate(()=>{ localStorage.setItem("snapfit_v2_textscale","comfortable"); });

  console.log("\n── JSON BACKUP ROUND-TRIP ───────────────────────");
  await page.evaluate(()=>localStorage.setItem("snapfit_v2_apikey","sk-ant-backup-test"));
  await page.reload({waitUntil:"networkidle"});
  await page.waitForTimeout(1200);
  await page.getByRole("button", {name:"Progress", exact:true}).click();
  await page.getByRole("tab", {name:"History", exact:true}).click();
  await page.waitForTimeout(350);
  await page.getByText("Data", {exact:true}).click();
  await page.waitForTimeout(250);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByText("EXPORT JSON").click(),
  ]);
  const backup = fs.readFileSync(await download.path(),"utf8");
  const parsed = JSON.parse(backup);
  check("backup has the training data", Array.isArray(parsed.sessions) && !!parsed.block);
  check("backup includes the API key", parsed.apiKey === "sk-ant-backup-test");

  const restore = async (text) => {
    await page.getByRole("button", {name:"Progress", exact:true}).click();
    await page.getByRole("tab", {name:"History", exact:true}).click();
    await page.waitForTimeout(400);
    await page.getByText("Data", {exact:true}).click();
    await page.waitForTimeout(300);
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByText("RESTORE JSON").click(),
    ]);
    await chooser.setFiles({name:"b.json", mimeType:"application/json", buffer:Buffer.from(text)});
    await page.waitForTimeout(600);
  };

  // A wrong-shaped file must be named as such and change nothing.
  await restore('{"hello":"world"}');
  let rt = await page.locator("body").innerText();
  check("bad file rejected specifically", /version marker/.test(rt), rt.slice(0,300));
  check("bad file changed nothing", /Nothing on this device has been changed/.test(rt));
  check("data still intact after a rejection",
    (await page.evaluate(()=>JSON.parse(localStorage.getItem("snapfit_v2")).sessions.length)) === parsed.sessions.length);

  await restore('{"v":2,"sessions":"not-a-list"}');
  check("corrupt field rejected specifically", /`sessions` field is corrupt/.test(await page.locator("body").innerText()));

  // Now wipe and restore for real.
  await page.evaluate(()=>{
    localStorage.setItem("snapfit_v2", JSON.stringify({v:2,onboarded:true,goal:{type:"lose_fat"},sessions:[],exerciseHistory:{},weights:{}}));
    localStorage.setItem("snapfit_v2_apikey","sk-ant-wrong-key");
  });
  await page.reload({waitUntil:"networkidle"});
  await page.waitForTimeout(1800);
  await restore(backup);
  rt = await page.locator("body").innerText();
  check("restore shows what's in the file first", /WHAT'S IN THE FILE/.test(rt), rt.slice(0,300));
  check("preview counts the sessions", new RegExp(`${parsed.sessions.length}`).test(rt));
  check("preview says the API key is included", /API key\s+included/.test(rt), rt.slice(0,500));
  await page.getByText("Replace everything").click();
  await page.waitForTimeout(1200);
  const restored = await page.evaluate(()=>JSON.parse(localStorage.getItem("snapfit_v2")));
  check("sessions came back", restored.sessions.length === parsed.sessions.length,
    `${restored.sessions.length} vs ${parsed.sessions.length}`);
  check("goal came back", restored.goal?.type === parsed.goal?.type, `${restored.goal?.type} vs ${parsed.goal?.type}`);
  check("history came back",
    Object.keys(restored.exerciseHistory||{}).length === Object.keys(parsed.exerciseHistory||{}).length);
  check("working weights came back",
    Object.keys(restored.weights||{}).length === Object.keys(parsed.weights||{}).length);
  check("API key came back", await page.evaluate(()=>localStorage.getItem("snapfit_v2_apikey")) === parsed.apiKey);
  check("API key stays out of the main state blob", !("apiKey" in restored));

  console.log("\n── PERSISTENCE ──────────────────────────────────");
  await page.reload({waitUntil:"networkidle"});
  await page.waitForTimeout(2200);
  const after = await page.locator("body").innerText();
  check("state survives reload", !/NOT JUST A/.test(after), after.slice(0,150));

  console.log("\n── RESPONSIVE ───────────────────────────────────");
  await page.setViewportSize({width:320,height:640});
  await page.waitForTimeout(500);
  const scrollW = await page.evaluate(()=>document.documentElement.scrollWidth);
  check("no horizontal scroll at 320px", scrollW <= 322, `scrollWidth ${scrollW}`);

  console.log("\n── CONSOLE ──────────────────────────────────────");
  check("zero console errors overall", errors.length===0, errors.slice(0,5).join(" | "));
  if(errors.length) errors.slice(0,10).forEach(e=>console.log("     ! "+e));

  await browser.close();
  server.close();
  console.log(`\n${failures===0 ? "ALL CHECKS PASSED" : failures+" CHECK(S) FAILED"}\n`);
  process.exit(failures?1:0);
})().catch(e=>{ console.error("HARNESS ERROR:", e.message); console.error(errors.slice(0,5)); server.close(); process.exit(2); });
