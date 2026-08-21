/* pack.js — build a password-encrypted static copy of the board.
 *
 *   node pack.js "your passphrase here"
 *
 * Produces docs/index.html: a lock screen plus an AES-256-GCM ciphertext.
 * Nothing about the board — not the roles, not the resume notes, not the
 * page chrome — exists in that file in readable form. Serve it anywhere,
 * publicly, including GitHub Pages.
 */
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");
const subtle = webcrypto.subtle;
const getRandomValues = webcrypto.getRandomValues.bind(webcrypto);

// Source folder: an explicit 3rd argument, else ../rebuild when we live in
// tools/, else our own folder. Output always goes to <root>/docs/index.html.
const SRC = process.argv[3]
  ? path.resolve(process.argv[3])
  : (path.basename(__dirname) === "tools"
      ? path.join(__dirname, "..", "rebuild")
      : __dirname);
const ROOT = path.join(SRC, "..");
const read = f => fs.readFileSync(path.join(SRC, f), "utf8");

const PASSPHRASE = process.argv[2];
if (!PASSPHRASE || PASSPHRASE.length < 12) {
  console.error("Usage: node pack.js \"<passphrase, 12+ chars>\" [source-dir]");
  console.error("Short passphrases can be brute-forced offline once the file is public. Use 20+.");
  process.exit(1);
}

const ITER = 600000; // OWASP-recommended floor for PBKDF2-SHA256

(async () => {
  const roles = JSON.parse(read("roles.json"));
  const meta  = JSON.parse(read("meta.json"));
  const css   = read("page.css");
  const renderSrc = read("render.js");
  const appSrc    = read("app.js");
  let shell = read("shell.html");

  let RB;
  try {
    RB = new Function(renderSrc + "\n" + appSrc + "\nreturn typeof RB !== 'undefined' ? RB : null;")();
  } catch (e) { RB = null; }
  if (!RB) {
    try { RB = new Function(renderSrc + "\nreturn typeof RB !== 'undefined' ? RB : null;")(); }
    catch (e) { RB = null; }
  }
  if (!RB) {
    console.error("The renderer could not be loaded from render.js / app.js.");
    console.error("Neither file defines RB. Re-run tools/unpack.js and try again.");
    process.exit(1);
  }
  const list = RB.tabSet(roles, meta, "new");

  shell = shell
    .replace('<div class="strip" id="strip"></div>',
             '<div class="strip" id="strip">' + RB.stripHTML(roles, meta) + "</div>")
    .replace('<div class="tabs" id="tabs" role="tablist"></div>',
             '<div class="tabs" id="tabs" role="tablist">' + RB.tabsHTML(roles, meta, "new") + "</div>")
    .replace('<div class="rows" id="rows"></div>',
             '<div class="rows" id="rows">' + RB.rowsHTML(list, meta, "new") + "</div>")
    .replace('<span class="count" id="count"></span>',
             '<span class="count" id="count">' + list.length + " shown</span>")
    .replace('<pre id="manifest"></pre>',
             '<pre id="manifest">' + RB.esc(RB.manifestHTML(roles, meta)) + "</pre>")
    .replace('<p class="log" id="log"></p>',
             '<p class="log" id="log">Sweeps: ' + meta.runs.join("  &middot;  ") + "</p>");

  const payload = JSON.stringify({
    title: "Shrey's Role Fit Board",
    css: css,
    shell: shell,
    data: JSON.stringify({ roles, meta }),
    render: renderSrc,
    app: appSrc
  });

  const salt = getRandomValues(new Uint8Array(16));
  const iv   = getRandomValues(new Uint8Array(12));
  const base = await subtle.importKey("raw", new TextEncoder().encode(PASSPHRASE), "PBKDF2", false, ["deriveKey"]);
  const key  = await subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(payload));

  const b64 = u8 => Buffer.from(u8).toString("base64");
  const blob = JSON.stringify({ v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) });

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Locked</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Public+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{--ground:#F1F4F3;--surface:#FFF;--ink:#14201E;--ink-2:#56645F;--ink-3:#84948E;
 --line:#D5DDDA;--accent:#0F6E68;--on-accent:#FFF;--bad:#8C3B34}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--ground:#0D1413;--surface:#151F1D;
 --ink:#E7EDEB;--ink-2:#9BAAA5;--ink-3:#6E7F7A;--line:#26332F;--accent:#54C3B7;--on-accent:#0D1413;--bad:#E08C84}}
:root[data-theme="dark"]{--ground:#0D1413;--surface:#151F1D;--ink:#E7EDEB;--ink-2:#9BAAA5;
 --ink-3:#6E7F7A;--line:#26332F;--accent:#54C3B7;--on-accent:#0D1413;--bad:#E08C84}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);
 font-family:"Public Sans",system-ui,-apple-system,sans-serif;line-height:1.55}
#lock{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px}
/* Scoped to #lock. The board injects its own stylesheet on unlock and #lock is
   removed, but an unscoped element rule here would stay in the cascade and hit
   every control on the board. This caused tabs and chips to stack full-width. */
#lock .card{background:var(--surface);border:1px solid var(--line);border-radius:4px;
 padding:34px 34px 30px;max-width:40ch;width:100%}
#lock .eyebrow{font-family:"IBM Plex Mono",monospace;font-size:10.5px;letter-spacing:.14em;
 text-transform:uppercase;color:var(--accent);font-weight:500;margin:0 0 10px}
#lock h1{font-family:"Fraunces",Georgia,serif;font-size:1.6rem;font-weight:600;margin:0 0 8px;letter-spacing:-.02em}
#lock p.sub{margin:0 0 20px;color:var(--ink-2);font-size:.9rem}
#lock label{display:block;font-size:.78rem;font-weight:600;margin-bottom:6px;color:var(--ink-2)}
#lock input{width:100%;font-family:"IBM Plex Mono",monospace;font-size:.9rem;padding:10px 12px;
 background:var(--ground);border:1px solid var(--line);border-radius:3px;color:var(--ink)}
#lock input:focus-visible,#lock button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#lock button{margin-top:12px;width:100%;background:var(--accent);color:var(--on-accent);border:none;
 border-radius:3px;padding:11px;font-size:.9rem;font-weight:600;cursor:pointer}
#lock button[disabled]{opacity:.6;cursor:progress}
#lock .msg{margin-top:12px;font-size:.82rem;min-height:1.2em}
#lock .msg.err{color:var(--bad)}
#lock .msg.busy{color:var(--ink-2)}
#lock .foot{margin-top:22px;padding-top:16px;border-top:1px solid var(--line);
 font-size:.76rem;color:var(--ink-3);line-height:1.6}
</style>
</head>
<body>
<div id="lock">
  <form class="card" id="f" autocomplete="off">
    <p class="eyebrow">Encrypted</p>
    <h1>This page is locked</h1>
    <p class="sub">The contents are encrypted in the file itself. Without the passphrase there is nothing here to read &mdash; not for a visitor, not for whoever hosts it.</p>
    <label for="p">Passphrase</label>
    <input id="p" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" autofocus>
    <button id="go" type="submit">Unlock</button>
    <div class="msg" id="m" role="status" aria-live="polite"></div>
    <p class="foot">AES-256-GCM, key stretched with PBKDF2-SHA256 over ${ITER.toLocaleString("en-US")} iterations. There is no reset &mdash; a lost passphrase means rebuilding the page.</p>
  </form>
</div>
<div id="app"></div>
<script type="application/json" id="blob">${blob.replace(/</g, "\\u003c")}</script>
<script>
(function () {
  var lock = document.getElementById("lock"), f = document.getElementById("f"),
      pw = document.getElementById("p"), go = document.getElementById("go"), m = document.getElementById("m");
  var blob = JSON.parse(document.getElementById("blob").textContent);
  var b2u = function (b) { return Uint8Array.from(atob(b), function (c) { return c.charCodeAt(0); }); };

  function say(t, cls) { m.textContent = t; m.className = "msg" + (cls ? " " + cls : ""); }

  async function unlock(pass, quiet) {
    var enc = new TextEncoder();
    var base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    var key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b2u(blob.salt), iterations: blob.iter, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    var plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b2u(blob.iv) }, key, b2u(blob.ct));
    var p = JSON.parse(new TextDecoder().decode(plain));

    var st = document.createElement("style"); st.id = "css"; st.textContent = p.css;
    document.head.appendChild(st);
    document.title = p.title;

    var app = document.getElementById("app");
    app.innerHTML = '<div id="shell">' + p.shell + "</div>";

    var d = document.createElement("script");
    d.type = "application/json"; d.id = "data"; d.textContent = p.data;
    app.appendChild(d);

    window.RFB_STATIC = true;
    window.RFB_PASS = pass;   // used only to encrypt marks before they leave the browser
    var s = document.createElement("script"); s.id = "app-src";
    s.textContent = (p.render ? p.render + String.fromCharCode(10) : "") + p.app;
    document.body.appendChild(s);

    lock.remove();
    try { sessionStorage.setItem("rfb.pass", pass); } catch (e) {}
    if (quiet) return;
  }

  f.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!pw.value) return;
    go.disabled = true; say("Deriving key\\u2026 this takes a second.", "busy");
    try {
      await unlock(pw.value);
    } catch (err) {
      go.disabled = false;
      say("That passphrase doesn't decrypt this page.", "err");
      pw.select();
    }
  });

  // Re-entry within the same tab session shouldn't ask again.
  try {
    var cached = sessionStorage.getItem("rfb.pass");
    if (cached) { say("Unlocking\\u2026", "busy"); unlock(cached, true).catch(function () {
      sessionStorage.removeItem("rfb.pass"); say(""); }); }
  } catch (e) {}
})();
<\/script>
</body>
</html>`;

  // Self-test before writing: a page that doesn't decrypt must never reach the repo.
  const vkey = await subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" },
    await subtle.importKey("raw", new TextEncoder().encode(PASSPHRASE), "PBKDF2", false, ["deriveKey"]),
    { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  let check;
  try {
    check = JSON.parse(new TextDecoder().decode(
      await subtle.decrypt({ name: "AES-GCM", iv }, vkey, ct)));
  } catch (e) {
    console.error("SELF-TEST FAILED: the page did not decrypt. Nothing written.");
    process.exit(1);
  }
  const back = JSON.parse(check.data).roles.length;
  if (back !== roles.length) {
    console.error("SELF-TEST FAILED: expected " + roles.length + " roles, got " + back + ". Nothing written.");
    process.exit(1);
  }

  const out = path.join(ROOT, "docs", "index.html");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log("docs/index.html written:", (html.length / 1024).toFixed(1) + "KB");
  console.log("self-test passed —", back, "roles decrypt cleanly | PBKDF2:", ITER.toLocaleString("en-US"));
})();
