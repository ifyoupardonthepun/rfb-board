/* publish.js — commit files to GitHub over the REST API, no git required.
 *
 *   GH_TOKEN=... node tools/publish.js "<commit message>" docs/index.html [more files...]
 *
 * The sandbox that runs the scheduled sweep can clone over git but cannot push
 * (its credential proxy only serves an allowlisted repo set). The Contents API
 * is a different route entirely: plain HTTPS with a fine-grained token.
 *
 * Only the files named on the command line are touched. docs/marks.json is
 * never included, so a sweep cannot clobber the mark history.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const TOKEN = process.env.GH_TOKEN;
const [, , message, ...files] = process.argv;

if (!TOKEN) { console.error("Set GH_TOKEN to a fine-grained token with Contents: Read and write."); process.exit(1); }
if (!message || !files.length) {
  console.error('Usage: GH_TOKEN=... node tools/publish.js "<message>" <file> [file...]');
  process.exit(1);
}
if (files.some(f => path.normalize(f) === path.join("docs", "marks.json"))) {
  console.error("Refusing to publish docs/marks.json — that file belongs to the browser.");
  process.exit(1);
}

// Repo comes from the git remote, so this cannot be pointed at the wrong place.
let owner, repo;
try {
  const url = execSync("git config --get remote.origin.url", { encoding: "utf8" }).trim();
  const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
  if (!m) throw new Error("unrecognised remote: " + url);
  owner = m[1]; repo = m[2];
} catch (e) { console.error("Could not read the git remote: " + e.message); process.exit(1); }

const API = "https://api.github.com/repos/" + owner + "/" + repo + "/contents/";
const H = { "Authorization": "Bearer " + TOKEN, "Accept": "application/vnd.github+json", "User-Agent": "role-scout" };

async function currentSha(p) {
  const r = await fetch(API + p + "?ref=main", { headers: H });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("read " + p + ": HTTP " + r.status + " " + (await r.text()).slice(0, 200));
  return (await r.json()).sha;
}

async function put(p, attempt) {
  const body = {
    message: message,
    content: fs.readFileSync(p).toString("base64"),
    branch: "main"
  };
  const sha = await currentSha(p);
  if (sha) body.sha = sha;

  const r = await fetch(API + p, { method: "PUT", headers: H, body: JSON.stringify(body) });
  if (r.status === 409 && (attempt || 0) < 2) {          // someone else wrote first
    await new Promise(s => setTimeout(s, 800));
    return put(p, (attempt || 0) + 1);
  }
  if (!r.ok) throw new Error("write " + p + ": HTTP " + r.status + " " + (await r.text()).slice(0, 300));
  const j = await r.json();
  return j.commit.sha.slice(0, 7);
}

(async () => {
  console.log("Publishing to " + owner + "/" + repo + " via the REST API");
  let last = null;
  for (const f of files) {
    if (!fs.existsSync(f)) { console.error("  missing: " + f); process.exit(1); }
    try {
      last = await put(f.split(path.sep).join("/"));
      console.log("  " + f + " -> " + last);
    } catch (e) {
      console.error("  FAILED " + f + ": " + e.message);
      if (/Host not in allowlist/.test(e.message)) {
        console.error("\n  api.github.com is blocked by this environment's network egress rules.");
        console.error("  Add it under environment settings -> Code -> Network access -> Allowed domains.");
      }
      process.exit(1);
    }
  }
  console.log("Published. Commit " + last + " — GitHub Pages redeploys within a minute.");
})();
