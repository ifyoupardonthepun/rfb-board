/* merge.js — fold a patch of newly-found roles into roles.json.
 *
 *   node merge.js patch-2026-08-22.json
 *
 * A patch is a JSON array of role objects from a scheduled sweep. Roles whose
 * key already exists are skipped, so running the same patch twice is harmless.
 * Existing roles — and any marks recorded against them — are never touched.
 */
const fs = require("fs");
const path = require("path");

// Board data lives in rebuild/ (written by tools/unpack.js). Resolve it the
// same way pack.js does: ../rebuild when we run from tools/, else our own dir.
const D = path.basename(__dirname) === "tools"
  ? path.join(__dirname, "..", "rebuild")
  : __dirname;

const patchPath = process.argv[2];
if (!patchPath) {
  console.error("Usage: node merge.js <patch-file.json>");
  process.exit(1);
}
let PATCH = patchPath;
if (!fs.existsSync(PATCH)) {
  for (const alt of [path.resolve(process.cwd(), patchPath),
                     path.join(D, patchPath),
                     path.join(D, "..", patchPath)]) {
    if (fs.existsSync(alt)) { PATCH = alt; break; }
  }
}
if (!fs.existsSync(PATCH)) {
  console.error("Can't find " + patchPath);
  console.error("Looked in the current folder, rebuild/ and the repo root.");
  process.exit(1);
}

const rolesPath = path.join(D, "roles.json");
const metaPath  = path.join(D, "meta.json");

let roles, meta, patch;
try { roles = JSON.parse(fs.readFileSync(rolesPath, "utf8")); }
catch (e) {
  console.error("roles.json is missing or unreadable at " + rolesPath);
  console.error("Run tools/unpack.js first to recover it from docs/index.html.");
  process.exit(1);
}
try { meta = JSON.parse(fs.readFileSync(metaPath, "utf8")); }
catch (e) { meta = { latestRun: null, prevRun: null, runs: [] }; }
try {
  const raw = JSON.parse(fs.readFileSync(PATCH, "utf8"));
  patch = Array.isArray(raw) ? raw : (raw.roles || []);
} catch (e) { console.error("That patch file isn't valid JSON."); process.exit(1); }

if (!patch.length) { console.log("Patch is empty — nothing to merge."); process.exit(0); }

const REQUIRED = ["k", "s", "t", "c", "tr", "u", "w", "g", "gt", "y"];
const bad = patch.filter(r => REQUIRED.some(f => r[f] === undefined));
if (bad.length) {
  console.error("These entries are missing required fields, so nothing was merged:");
  bad.forEach(r => console.error("  " + (r.c || "?") + " — " + (r.t || "?")));
  process.exit(1);
}

const have = new Set(roles.map(r => r.k));
const runId = patch[0].seen || new Date().toISOString().slice(0, 10);

let added = 0, skipped = 0;
patch.forEach(r => {
  if (have.has(r.k)) { skipped++; return; }
  r.mark = r.mark || "";
  r.seen = r.seen || runId;
  r.f = r.f || [];
  roles.push(r);
  have.add(r.k);
  added++;
});

if (added) {
  if (meta.runs[meta.runs.length - 1] !== runId) {
    meta.prevRun = meta.runs[meta.runs.length - 1] || null;
    meta.runs.push(runId);
  }
  meta.latestRun = runId;
  fs.writeFileSync(rolesPath, JSON.stringify(roles, null, 1));
  fs.writeFileSync(metaPath, JSON.stringify(meta));
}

const marked = roles.filter(r => r.mark).length;
console.log("Merged " + added + " new role" + (added === 1 ? "" : "s") +
            (skipped ? ", skipped " + skipped + " already on the board" : "") + ".");
console.log("Board now holds " + roles.length + " roles" +
            (marked ? " (" + marked + " marked)" : "") + ".");
if (added) {
  const top = patch.filter(r => !r.markSkip).sort((a, b) => b.s - a.s).slice(0, 3);
  console.log("\nBest of this batch:");
  top.forEach(r => console.log("  " + r.s + "  " + r.c + " — " + r.t.replace(/&[a-z]+;/g, " ")));
}
