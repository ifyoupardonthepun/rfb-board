/* unpack.js — recover the board's source from an encrypted page.
 *
 *   node tools/unpack.js docs/index.html "<passphrase>" [outdir]
 *
 * Writes roles.json, meta.json, page.css, shell.html, render.js and app.js
 * into outdir (default: rebuild/). This is the inverse of pack.js, and it is
 * how an automated refresh recovers the current board without anything
 * sensitive ever being stored unencrypted in the repository.
 */
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");
const subtle = webcrypto.subtle;

const [, , pagePath, passphrase, outArg] = process.argv;
if (!pagePath || !passphrase) {
  console.error('Usage: node tools/unpack.js <page.html> "<passphrase>" [outdir]');
  process.exit(1);
}
if (!fs.existsSync(pagePath)) {
  console.error("Can't find " + pagePath);
  process.exit(1);
}

const outDir = outArg || path.join(path.dirname(pagePath), "..", "rebuild");

(async () => {
  const html = fs.readFileSync(pagePath, "utf8");
  const m = html.match(/id="blob">([\s\S]*?)<\/script>/);
  if (!m) {
    console.error("No encrypted payload found — is this the right file?");
    process.exit(1);
  }

  let blob;
  try { blob = JSON.parse(m[1].replace(/\\u003c/g, "<")); }
  catch (e) { console.error("The payload is malformed."); process.exit(1); }

  const b2u = b => Uint8Array.from(Buffer.from(b, "base64"));

  let payload;
  try {
    const base = await subtle.importKey("raw", new TextEncoder().encode(passphrase),
                                        "PBKDF2", false, ["deriveKey"]);
    const key = await subtle.deriveKey(
      { name: "PBKDF2", salt: b2u(blob.salt), iterations: blob.iter, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const plain = await subtle.decrypt({ name: "AES-GCM", iv: b2u(blob.iv) }, key, b2u(blob.ct));
    payload = JSON.parse(new TextDecoder().decode(plain));
  } catch (e) {
    console.error("Decryption failed — wrong passphrase, or the file is damaged.");
    console.error("Nothing was written. Do not rebuild or push from this state.");
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const data = JSON.parse(payload.data);
  const w = (name, content) => fs.writeFileSync(path.join(outDir, name), content);

  w("roles.json", JSON.stringify(data.roles, null, 1));
  w("meta.json", JSON.stringify(data.meta));
  w("page.css", payload.css);
  w("shell.html", payload.shell);

  // Pages built before the payload split stored both scripts merged in `app`.
  // Split them back apart: the renderer must be loadable on its own, because
  // pack.js evaluates it in Node, where the app half (which touches `document`
  // on load) would throw.
  if (!payload.render) {
    const merged = payload.app;
    const boundary = /\n\(function\s*\(\s*\)\s*\{\s*(?:"use strict"|'use strict');/;
    const m = boundary.exec(merged);
    if (m && merged.slice(0, m.index).indexOf("var RB") > -1) {
      w("render.js", merged.slice(0, m.index + 1));
      w("app.js", merged.slice(m.index + 1));
      console.log("  note: legacy payload — scripts split back apart");
    } else {
      console.error("Legacy payload, but the renderer and app could not be separated.");
      console.error("Nothing usable was written. Rebuild the page from a known-good source.");
      process.exit(1);
    }
  } else {
    w("render.js", payload.render);
    w("app.js", payload.app);
  }

  const marked = data.roles.filter(r => r.mark).length;
  console.log("Unpacked into " + outDir);
  console.log("  roles:  " + data.roles.length + (marked ? " (" + marked + " marked)" : ""));
  console.log("  sweeps: " + (data.meta.runs || []).join(", "));
})();
