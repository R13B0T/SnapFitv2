/* Shared bits for the test harnesses.

   The app loads React and Babel from unpkg. The tests intercept those requests
   and serve the identical UMD builds from node_modules instead, so the suite
   runs without network access and without touching index.html. */

const fs = require("fs");
const path = require("path");
const os = require("os");

const CACHE = path.join(os.tmpdir(), "snapfit-test-vendor");

const SOURCES = {
  "react.js":     "react/umd/react.production.min.js",
  "react-dom.js": "react-dom/umd/react-dom.production.min.js",
  "babel.js":     "@babel/standalone/babel.min.js",
};

function vendor(name){
  const cached = path.join(CACHE, name);
  if(fs.existsSync(cached)) return cached;
  const src = SOURCES[name];
  if(!src) throw new Error(`No vendor mapping for ${name}`);
  // Can't require.resolve the subpath directly — these packages declare an
  // "exports" map that doesn't expose umd/. Resolve the package root instead.
  const pkg = src.split("/")[0].startsWith("@") ? src.split("/").slice(0,2).join("/") : src.split("/")[0];
  const rest = src.slice(pkg.length + 1);
  let resolved;
  try{
    const pkgRoot = path.dirname(require.resolve(`${pkg}/package.json`, {paths:[path.join(__dirname,"..")]}));
    resolved = path.join(pkgRoot, rest);
  }catch{ resolved = null; }
  if(!resolved || !fs.existsSync(resolved)){
    throw new Error(
      `Missing ${src}. Run:\n  npm install`);
  }
  fs.mkdirSync(CACHE, {recursive:true});
  fs.copyFileSync(resolved, cached);
  return cached;
}

/* Playwright's bundled browser download is often absent in CI images that
   already ship a Chromium. Prefer whatever is actually on disk. */
function launchOpts(){
  const candidates = [
    process.env.CHROMIUM_PATH,
    ...(fs.existsSync("/opt/pw-browsers")
      ? fs.readdirSync("/opt/pw-browsers")
          .filter(d => d.startsWith("chromium-"))
          .map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`)
      : []),
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].filter(Boolean);
  const found = candidates.find(p => { try{ return fs.existsSync(p); }catch{ return false; } });
  return found ? {executablePath: found, args:["--no-sandbox"]} : {args:["--no-sandbox"]};
}

module.exports = { vendor, launchOpts };
