/**
 * The Studio's two static files, served from code (docs/CONTENT_STUDIO_DESIGN.md
 * §8): `/static/studio.css`, the only styles any page uses, and
 * `/static/studio.js`, the one small script — the Copy buttons (S5), the
 * new-run form's scope upper bound (S6.2), and (S7.2) the fact upload and the
 * import: the chosen file, or the chosen folder's known files, read in the
 * browser, each base64-encoded beside its sha256, and put as ONE JSON document
 * in the form's `document` field before the form is submitted with its
 * synchronizer token, as every form is; the script sends nothing itself.
 * Content Studio S5.
 *
 * No page carries an inline script or an inline style, so S4's CSP
 * (`script-src 'self'`, and `default-src 'self'` for styles) is unchanged. Each
 * page links a file by its sha256 (`?v=`), so the file can be cached for a year
 * and a new build is fetched at once.
 *
 * The layout (§8): one column below 700 px, every tap target at least 44 px,
 * no horizontal scroll (long words, links and fingerprints wrap; only a wide
 * table scrolls, inside its own box), and captions in a wrapping, proportional
 * block with their Copy buttons directly beneath. `scripts/local/studio-layout-check.mjs`
 * measures it in Chromium at 375 px.
 */

import { createHash } from "node:crypto";

const CSS = `:root{color-scheme:light;--ink:#1d1d1f;--muted:#5b5b66;--line:#d9d9de;--panel:#f6f6f8;--accent:#0b5cad;--warn:#8a4b00;--bad:#a1121a}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:#fff;overflow-wrap:anywhere}
main{max-width:60rem;margin:0 auto;padding:1rem}
a{color:var(--accent)}
a,button,select,summary,input[type=submit]{min-height:44px;min-width:44px}
a{display:inline-flex;align-items:center}
button,select{font:inherit;padding:.4rem .9rem;border:1px solid var(--line);border-radius:.4rem;background:#fff;color:var(--ink)}
button:not([disabled]){cursor:pointer}
button[disabled]{color:var(--muted);background:var(--panel)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em;word-break:break-all}
.top{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1rem;padding:.5rem 1rem;border-bottom:1px solid var(--line)}
.top .brand{font-weight:700;text-decoration:none;color:var(--ink)}
.top nav{display:flex;flex-wrap:wrap;gap:0 1rem}
.top .who{color:var(--muted);margin-left:auto}
.top form{margin:0}
h1{font-size:1.4rem;line-height:1.3;margin:.5rem 0 1rem}
h2{font-size:1.15rem;margin:1.75rem 0 .5rem;padding-top:.75rem;border-top:1px solid var(--line)}
h3{font-size:1rem;margin:1rem 0 .25rem}
.prose{white-space:pre-wrap;overflow-wrap:anywhere}
.meta,.note{color:var(--muted)}
.badge{display:inline-block;font-size:.75rem;font-weight:700;letter-spacing:.04em;padding:.1rem .45rem;border-radius:.3rem;margin-left:.4rem;vertical-align:middle}
.badge-fake{background:#fde7c7;color:var(--warn)}
.badge-unverified{background:#fbe1e3;color:var(--bad)}
.state{font-weight:600}
.state-failed,.state-refused,.state-interrupted{color:var(--bad)}
.filters{display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:flex-end;margin-bottom:1rem}
.filters label{display:flex;flex-direction:column;font-size:.9rem;color:var(--muted)}
.runs{list-style:none;margin:0;padding:0}
.run{padding:.75rem 0;border-bottom:1px solid var(--line)}
.run p{margin:.15rem 0}
.run-goal{font-weight:600}
.pager{display:flex;gap:1.5rem;margin-top:1rem}
.facts{display:grid;grid-template-columns:minmax(8rem,14rem) 1fr;gap:.25rem 1rem;margin:0}
.facts dt{color:var(--muted)}
.facts dd{margin:0;min-width:0}
.facts ul{margin:0;padding-left:1.1rem}
.fp summary{display:inline-flex;align-items:center;cursor:pointer}
.fp-full{display:block}
.failure{border-left:4px solid var(--bad);padding-left:.75rem}
.failure dd{margin:0 0 .5rem}
.sections{display:flex;flex-direction:column}
.banner{background:var(--panel);border-left:4px solid var(--accent);padding:.5rem .75rem}
.card{border:1px solid var(--line);border-radius:.5rem;padding:.75rem;margin:.75rem 0}
.card h3{margin-top:0}
.caption{font-family:inherit;margin:.25rem 0}
.contact{margin:.25rem 0;color:var(--muted)}
.copy-row{display:flex;flex-wrap:wrap;gap:.5rem;margin:.5rem 0}
.finding{margin:.4rem 0}
.finding .sev{font-weight:700;text-transform:uppercase;font-size:.8rem}
.finding-blocking .sev{color:var(--bad)}
.finding p{margin:.15rem 0}
.findings ul,.decisions ul{padding-left:1.1rem}
.decisions-open{background:#fff8ec;border-radius:.5rem;padding:0 .75rem .5rem}
.table{overflow-x:auto;max-width:100%}
table{border-collapse:collapse;font-size:.9rem}
th,td{border-bottom:1px solid var(--line);padding:.35rem .5rem;text-align:left;white-space:nowrap}
.files li{margin:.25rem 0}
.action-form{display:flex;flex-direction:column;gap:.75rem;max-width:44rem}
.action-form textarea{font:inherit;width:100%;max-width:100%;padding:.5rem;border:1px solid var(--line);border-radius:.4rem}
.field{font-weight:600}
fieldset{border:1px solid var(--line);border-radius:.5rem;padding:.5rem .75rem;margin:0;min-width:0}
legend{font-weight:600;padding:0 .25rem}
.check{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;min-height:44px}
.check input{width:44px;height:44px;margin:0}
.buttons{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
.buttons form{margin:0}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button.danger{border-color:var(--bad);color:var(--bad)}
button.fake{border-color:var(--warn);color:var(--warn)}
.banner-warn{border-left-color:var(--warn)}
.banner-bad{border-left-color:var(--bad)}
.banner-fake{border-left-color:var(--warn);background:#fde7c7}
.refusal{border-left:4px solid var(--bad);padding-left:.75rem}
.plan ul,.lines,.overruns{padding-left:1.1rem}
.lines{margin:.25rem 0 0;font-size:.85rem;white-space:normal}
td .lines li{white-space:normal}
.total{font-size:1.1rem}
.confirm{margin:1rem 0}
.overruns form{display:inline-block;margin-left:.5rem}
.versions{list-style:none;margin:0;padding:0}
.version{padding:.75rem 0;border-bottom:1px solid var(--line)}
.version p{margin:.15rem 0}
.badge-active{background:#dff3e3;color:#11602b}
.tag-counts{padding-left:1.1rem;margin:.25rem 0}
input[type=file]{min-height:44px;max-width:100%;font:inherit}
input[type=text],input[type=email]{min-height:44px;max-width:100%;font:inherit;padding:.4rem .5rem;border:1px solid var(--line);border-radius:.4rem}
.users,.audit-log{list-style:none;margin:0;padding:0}
.user,.audit{padding:.75rem 0;border-bottom:1px solid var(--line)}
.user p,.audit p{margin:.15rem 0}
.inline-form{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:0}
.inline-form input[type=text]{width:7rem}
.detail{white-space:pre-wrap;overflow-wrap:anywhere;margin:.25rem 0;padding:.5rem;background:var(--panel);border-radius:.4rem;font-size:.85rem}
@media (max-width:699.98px){
main{padding:.75rem}
.facts{grid-template-columns:1fr}
.facts dt{margin-top:.5rem}
.top .who{margin-left:0;width:100%}
.decisions-open{order:-1}
}
`;

const JS = `"use strict";
// The Copy buttons (Content Studio S5): each copies its data-copy attribute exactly as the server wrote it.
document.addEventListener("click", function (event) {
  var target = event.target;
  var button = target && target.closest ? target.closest("button.copy") : null;
  if (!button || button.disabled) return;
  var text = button.getAttribute("data-copy");
  if (text === null) return;
  var label = button.textContent;
  var done = function (ok) {
    button.textContent = ok ? "Copied" : "Copy failed: select the text";
    setTimeout(function () { button.textContent = label; }, 2000);
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
  else done(false);
});
// The new-run form (Content Studio S6.2): the scope's UPPER BOUND, the sum of the ticked tags' counts. Tags
// overlap, so it can only over-count; the worker's free check enforces the pack's record cap exactly.
document.addEventListener("change", function (event) {
  var target = event.target;
  if (!target || target.name !== "tag") return;
  var out = document.querySelector("[data-scope-bound]");
  if (!out) return;
  var boxes = document.querySelectorAll("input[name=tag]:checked");
  var sum = 0;
  for (var i = 0; i < boxes.length; i++) sum += Number(boxes[i].getAttribute("data-count")) || 0;
  out.textContent = boxes.length ? "At most " + sum + " records carry the chosen tags (an upper bound), plus the always-included contact and identity records."
    : "No tags chosen: an unscoped run, with every record.";
});
// The fact upload and the import (Content Studio S7.2): read here, each file base64-encoded beside its sha256, and ONE JSON
// document put in the form's "document" field; then the form is submitted as any form is. This script sends nothing itself.
function studioHex(buffer) {
  var bytes = new Uint8Array(buffer), text = "";
  for (var i = 0; i < bytes.length; i++) text += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
  return text;
}
function studioBase64(bytes) {
  var text = "";
  for (var i = 0; i < bytes.length; i += 32768) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  return btoa(text);
}
function studioEncode(file) {
  return file.arrayBuffer().then(function (buffer) {
    return crypto.subtle.digest("SHA-256", buffer).then(function (digest) {
      return { sha256: studioHex(digest), base64: studioBase64(new Uint8Array(buffer)) };
    });
  });
}
document.addEventListener("submit", function (event) {
  var form = event.target;
  var kind = form && form.getAttribute ? form.getAttribute("data-upload") : null;
  if (kind !== "facts" && kind !== "import") return;
  event.preventDefault();
  var status = form.querySelector("[data-upload-status]");
  var say = function (text) { if (status) status.textContent = text; };
  var field = form.querySelector("input[name=document]");
  var input = form.querySelector("input[type=file]");
  var files = input && input.files ? Array.prototype.slice.call(input.files) : [];
  if (!field) return;
  if (!window.crypto || !crypto.subtle) { say("This browser cannot compute a sha256 here: a secure connection is needed."); return; }
  var built;
  if (kind === "facts") {
    if (files.length !== 1) { say("Choose one file."); return; }
    if (files[0].size > 1048576) { say("The file is larger than 1 MiB."); return; }
    built = studioEncode(files[0]);
  } else {
    var known = (form.getAttribute("data-known-names") || "").split(" ");
    var chosen = files.filter(function (f) {
      return (f.webkitRelativePath || f.name).split("/").length <= 2 && known.indexOf(f.name) >= 0;
    });
    if (!chosen.length) { say("That folder holds none of the CLI's known run files."); return; }
    built = Promise.all(chosen.map(function (f) {
      return studioEncode(f).then(function (e) { return { name: f.name, sha256: e.sha256, base64: e.base64 }; });
    })).then(function (list) { return { schema: "gcd-studio-run-bundle/1", files: list }; });
  }
  say("Reading...");
  built.then(function (doc) {
    field.value = JSON.stringify(doc);
    say("Sending...");
    form.submit();
  }, function () { say("The file could not be read; nothing was sent."); });
});
`;

export interface StaticAsset {
  path: string;
  /** What a page links: the path and the file's version. */
  href: string;
  contentType: string;
  body: Buffer;
  sha256: string;
}

function asset(path: string, contentType: string, text: string): StaticAsset {
  const body = Buffer.from(text, "utf8");
  const sha256 = createHash("sha256").update(body).digest("hex");
  return Object.freeze({ path, href: `${path}?v=${sha256.slice(0, 16)}`, contentType, body, sha256 });
}

export const STATIC_ASSETS = Object.freeze({
  css: asset("/static/studio.css", "text/css; charset=utf-8", CSS),
  js: asset("/static/studio.js", "text/javascript; charset=utf-8", JS),
});

/** A year, privately: the URL changes with the file, and every file is behind sign-in. */
export const STATIC_CACHE_CONTROL = "private, max-age=31536000, immutable";
