const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { vendor, launchOpts } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PORT = 8899;

const MIME = {".html":"text/html",".js":"application/javascript",".json":"application/json",".css":"text/css"};

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

function check(name, ok, detail){
  console.log(`${ok?"  PASS":"  FAIL"}  ${name}${detail&&!ok?` — ${detail}`:""}`);
  if(!ok) failures++;
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

  page.on("console", m=>{ logs.push(`${m.type()}: ${m.text()}`); if(m.type()==="error") errors.push(m.text()); });
  page.on("pageerror", e=>errors.push("pageerror: "+e.message));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, {waitUntil:"networkidle"});
  await page.waitForTimeout(2500);

  console.log("\n── BOOT ─────────────────────────────────────────");
  const rootHtml = await page.locator("#root").innerHTML();
  check("app mounts", rootHtml.length > 200, `root had ${rootHtml.length} chars`);
  check("no console errors on boot", errors.length===0, errors.slice(0,3).join(" | "));
  check("welcome screen renders", await page.getByText("NOT JUST A").isVisible().catch(()=>false));

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
  check("reaches check-in", /HOW ARE YOU TODAY/i.test(bodyText), bodyText.slice(0,200));
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
  check("photo path is offered", /Photograph it/.test(vt));
  check("photo path explains it needs a key", /no way to read a photo offline/.test(vt), vt.slice(0,600));

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
  check("away gym says it's only for today", /just for today/.test(vt));
  const travel = await page.evaluate(()=>JSON.parse(localStorage.getItem("snapfit_v2")).travel);
  check("away gym persisted and active", travel?.active === true, JSON.stringify(travel));
  check("dumbbell ceiling stored", travel?.dumbbellMax === 15, `got ${travel?.dumbbellMax}`);
  check("home gym left untouched", (await page.evaluate(
    ()=>JSON.parse(localStorage.getItem("snapfit_v2")).equipment.enabled.length)) > 20);

  await page.getByText("BUILD TODAY'S SESSION").click();
  await page.waitForTimeout(2500);
  const awayText = await page.locator("body").innerText();
  check("session built at the away gym", /SET 1/.test(awayText), awayText.slice(0,300));
  check("venue chip on the session", /📍 Dumbbells and a bench/.test(awayText), awayText.slice(0,400));
  check("brief explains the venue", /not your usual gym/.test(awayText), awayText.slice(0,900));

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
  check("hotel session discarded on venue change", /HOW ARE YOU TODAY/i.test(vt), vt.slice(0,300));
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
  check("reuse stamps today's date", reused.date === new Date().toISOString().slice(0,10), reused.date);

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

  await page.getByText("BUILD TODAY'S SESSION").click();
  await page.waitForTimeout(2500);

  const sessText = await page.locator("body").innerText();
  check("session generated", /SET 1/.test(sessText), sessText.slice(0,300));
  const setBtns = await page.getByText("SET 1", {exact:true}).count();
  check("multiple exercises", setBtns >= 3, `found ${setBtns} exercises`);
  check("Why this? present", /Why this\?/.test(sessText));
  check("How to do it present", /How to do it/.test(sessText));

  console.log("\n── BRIEF & PRESCRIPTION ─────────────────────────");
  check("today's brief renders", /TODAY'S BRIEF/.test(sessText), sessText.slice(0,300));
  check("brief says what's required", /What's required/.test(sessText));
  check("brief sets a standard", /The standard/.test(sessText));
  check("prescription row present", /COACH SAYS/.test(sessText));
  const coachRows = await page.getByText("COACH SAYS", {exact:true}).count();
  check("one prescription per exercise", coachRows === setBtns, `${coachRows} rows vs ${setBtns} exercises`);
  // The brief must not push the first exercise off the screen entirely.
  const firstCardTop = await page.locator("text=COACH SAYS").first().evaluate(el=>el.getBoundingClientRect().top);
  check("first exercise reachable without a long scroll", firstCardTop < 1400, `top at ${Math.round(firstCardTop)}px`);

  console.log("\n── LOGGING A SET ────────────────────────────────");
  const prescribed = Number((sessText.match(/COACH SAYS\s*\n?\s*([\d.]+)kg/) || [])[1]);
  await page.getByText("SET 1", {exact:true}).first().click();
  await page.waitForTimeout(400);
  check("rep picker opens", /REPS COMPLETED/.test(await page.locator("body").innerText()));

  // Free-text weight: type it rather than tapping the stepper eleven times.
  const wField = page.locator('input[inputmode="decimal"]').first();
  await wField.click();
  await wField.fill("");
  for(const ch of "47.5"){ await wField.press(ch === "." ? "Period" : ch); }
  await wField.press("Enter");
  await page.waitForTimeout(250);
  check("typed weight commits", (await wField.inputValue()) === "47.5",
    `got ${JSON.stringify(await wField.inputValue())}`);

  await page.getByText("HOW DID IT FEEL?").click();
  await page.waitForTimeout(300);
  check("effort step", /LEFT IN THE TANK/.test(await page.locator("body").innerText()));
  check("effort step shows the typed weight", /47\.5kg/.test(await page.locator("body").innerText()));
  await page.getByText("Solid", {exact:true}).click();
  await page.waitForTimeout(200);
  await page.getByText("LOG IT").click();
  await page.waitForTimeout(600);
  let t2 = await page.locator("body").innerText();
  check("set logged", /1 of \d+ sets logged/.test(t2));
  check("rest timer appeared", /REST/.test(t2));

  console.log("\n── PRESCRIPTION VS REALITY ──────────────────────");
  check("prescription unchanged after an override",
    new RegExp(`COACH SAYS\\s*\\n?\\s*${prescribed}kg`).test(t2), `expected ${prescribed}kg still shown`);
  check("gap from the plan is called out", /You're [\d.]+kg (under|over) that/.test(t2), t2.slice(0,400));

  console.log("\n── WEIGHT CARRIES TO THE NEXT SET ───────────────");
  await page.getByText("SET 2", {exact:true}).first().click();
  await page.waitForTimeout(400);
  const w2 = page.locator('input[inputmode="decimal"]').first();
  check("set 2 offers the weight you actually lifted", (await w2.inputValue()) === "47.5",
    `got ${JSON.stringify(await w2.inputValue())}`);
  check("and still names the coach's number",
    /Coach says [\d.]+kg/.test(await page.locator("body").innerText()));
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
  await page.getByText("LEARN", {exact:true}).last().click();
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

  console.log("\n── FORM COACHING ────────────────────────────────");
  await page.getByText("How to do it").first().click();
  await page.waitForTimeout(600);
  const howText = await page.locator("body").innerText();
  check("cues render", /SET UP/.test(howText) && /COMMON MISTAKES/.test(howText), howText.slice(0,200));

  console.log("\n── FINISH & DEBRIEF ─────────────────────────────");
  await page.getByText("FINISH SESSION").click();
  await page.waitForTimeout(2500);
  const dbText = await page.locator("body").innerText();
  check("debrief renders", /SESSION DONE/.test(dbText), dbText.slice(0,200));
  check("debrief has progression rows", /WHAT MOVES NEXT TIME/.test(dbText));
  await page.getByText("DONE", {exact:true}).click();
  await page.waitForTimeout(600);

  console.log("\n── ALL TABS ─────────────────────────────────────");
  for(const [label, expect] of [["PLAN","YOUR BLOCK"],["GOAL","YOUR GOAL"],["COACH","COACH"],
                                 ["LEARN","LEARN"],["LOG","LOG"]]){
    await page.getByText(label, {exact:true}).last().click();
    await page.waitForTimeout(500);
    const t = await page.locator("body").innerText();
    check(`${label} tab renders`, t.includes(expect), t.slice(0,150));
  }

  console.log("\n── LEARN TOPIC + QUIZ ───────────────────────────");
  await page.getByText("LEARN", {exact:true}).last().click();
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
  check("wake lock toggle present", /Keep the screen awake/.test(st));
  check("test cues button present", /Test the cues/.test(st));

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
  const backup = await page.evaluate(()=>localStorage.getItem("snapfit_v2"));
  const parsed = JSON.parse(backup);
  check("backup has the training data", Array.isArray(parsed.sessions) && !!parsed.block);
  check("backup never contains the API key", !/snapfit_v2_apikey|sk-ant/.test(backup));

  const restore = async (text) => {
    await page.locator("text=📋").last().click();
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
  await page.evaluate(()=>{ localStorage.setItem("snapfit_v2", JSON.stringify({v:2,onboarded:true,goal:{type:"lose_fat"},sessions:[],exerciseHistory:{},weights:{}})); });
  await page.reload({waitUntil:"networkidle"});
  await page.waitForTimeout(1800);
  await restore(backup);
  rt = await page.locator("body").innerText();
  check("restore shows what's in the file first", /WHAT'S IN THE FILE/.test(rt), rt.slice(0,300));
  check("preview counts the sessions", new RegExp(`${parsed.sessions.length}`).test(rt));
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
