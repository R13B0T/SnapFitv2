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

  await page.getByText("BUILD TODAY'S SESSION").click();
  await page.waitForTimeout(2500);

  const sessText = await page.locator("body").innerText();
  check("session generated", /SET 1/.test(sessText), sessText.slice(0,300));
  const setBtns = await page.getByText("SET 1", {exact:true}).count();
  check("multiple exercises", setBtns >= 3, `found ${setBtns} exercises`);
  check("Why this? present", /Why this\?/.test(sessText));
  check("How to do it present", /How to do it/.test(sessText));

  console.log("\n── LOGGING A SET ────────────────────────────────");
  await page.getByText("SET 1", {exact:true}).first().click();
  await page.waitForTimeout(400);
  check("rep picker opens", /REPS COMPLETED/.test(await page.locator("body").innerText()));
  await page.getByText("HOW DID IT FEEL?").click();
  await page.waitForTimeout(300);
  check("effort step", /LEFT IN THE TANK/.test(await page.locator("body").innerText()));
  await page.getByText("Solid", {exact:true}).click();
  await page.waitForTimeout(200);
  await page.getByText("LOG IT").click();
  await page.waitForTimeout(600);
  check("set logged", /1 of \d+ sets logged/.test(await page.locator("body").innerText()));
  check("rest timer appeared", /REST/.test(await page.locator("body").innerText()));

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
