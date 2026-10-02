/**
 * The Studio's two static files, served from code (docs/CONTENT_STUDIO_DESIGN.md
 * §8): `/static/studio.css`, the only styles any page uses, and
 * `/static/studio.js`, the one small script — the Copy buttons. Content Studio S5.
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
.top nav{display:flex;gap:1rem}
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
