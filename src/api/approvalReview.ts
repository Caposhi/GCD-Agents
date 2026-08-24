import { canonicalApprovalJson, hashApprovalSubject } from "../harness/state.js";
import type { PostPackage } from "../mcp/posting-tool/types.js";
import { assertValidSocialPostSubject } from "../mcp/posting-tool/validation.js";

export interface ApprovalReviewData {
  id: string;
  token: string;
  summary: string;
  subjectType: string;
  subject: unknown;
  payloadSha256: string;
  tokenExpiresAt: string;
  authorizationExpiresAt: string;
}

function esc(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!,
  );
}

function prettyCanonicalJson(value: unknown): string {
  return JSON.stringify(JSON.parse(canonicalApprovalJson(value)), null, 2);
}

function field(label: string, value: unknown): string {
  if (value === undefined) return "";
  return `<div class="field"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
}

function mediaCards(pkg: PostPackage): string {
  if (!pkg.images?.length) return `<p class="none">No media in this provider payload.</p>`;
  return pkg.images.map((item, index) => `
    <section class="media">
      <img src="${esc(item.url)}" alt="${esc(item.altText ?? "Provider image with no supplied alt text")}" loading="lazy">
      <dl>
        ${field(`Media ${index + 1} URL`, item.url)}
        ${field("Inspected media SHA-256", item.contentSha256)}
        ${field("Alt text", item.altText ?? "(not supplied)")}
        ${field("AI-generated disclosure", item.aiGenerated === undefined ? "(not supplied)" : String(item.aiGenerated))}
      </dl>
    </section>`).join("");
}

function packageCard(pkg: PostPackage, index: number): string {
  const cta = pkg.gbp?.callToAction;
  return `<article class="payload">
    <header><span>Payload ${index + 1}</span><strong>${esc(pkg.platform)}</strong></header>
    <dl class="metadata">
      ${field(pkg.platform === "facebook" ? "Provider Page ID" : "Provider account ID", pkg.target.accountId)}
      ${field("GBP location ID", pkg.target.locationId)}
      ${field("API host", pkg.target.apiHost)}
      ${field("API version", pkg.target.apiVersion)}
      ${field("Language code", pkg.languageCode ?? "(not supplied)")}
      ${field("Delivery", pkg.platform === "facebook" && pkg.facebook?.scheduledPublishTime
        ? `scheduled at Unix time ${pkg.facebook.scheduledPublishTime}`
        : "immediate")}
      ${field("GBP topic type", pkg.gbp?.topicType)}
      ${field("GBP CTA action", cta?.actionType)}
      ${field("GBP CTA destination", cta?.url)}
      ${field("Facebook link", pkg.facebook?.link)}
      ${field("Facebook scheduled publish time", pkg.facebook?.scheduledPublishTime)}
    </dl>
    <h3>Exact provider text</h3>
    <pre class="post-text">${esc(pkg.text)}</pre>
    <h3>Exact provider media</h3>
    ${mediaCards(pkg)}
  </article>`;
}

/**
 * Render the exact hash-bound provider payload. The canonical JSON is always
 * shown in addition to the convenience cards so no provider-visible field can
 * be hidden by an incomplete preview component.
 */
export function renderApprovalReview(data: ApprovalReviewData): string {
  if (data.subjectType !== "social-post-packages/v1") {
    throw new Error(`unsupported approval subject type: ${data.subjectType || "missing"}`);
  }
  assertValidSocialPostSubject(data.subject);
  if (hashApprovalSubject(data.subject) !== data.payloadSha256) {
    throw new Error("approval subject hash mismatch");
  }

  const packages = data.subject as PostPackage[];
  const cards = packages.map(packageCard).join("");
  const exactJson = prettyCanonicalJson(data.subject);
  const css = `*{box-sizing:border-box}body{margin:0;background:#0f1420;color:#eef3fb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:820px;margin:auto;padding:24px 14px 48px}.top{margin-bottom:18px}.top h1{margin:0 0 8px;font-size:24px}.top p{color:#b8c5d9;line-height:1.45;margin:6px 0}.integrity,.payload,.exact{background:#fff;color:#111;border-radius:14px;padding:16px;margin:14px 0;box-shadow:0 6px 24px rgba(0,0,0,.25)}.integrity code{overflow-wrap:anywhere}.payload header{display:flex;justify-content:space-between;text-transform:capitalize;border-bottom:1px solid #dde3ea;padding-bottom:10px}.payload h3{font-size:13px;margin:18px 0 7px;color:#415168;text-transform:uppercase;letter-spacing:.04em}.metadata,.media dl{margin:10px 0}.field{display:grid;grid-template-columns:minmax(150px,35%) 1fr;gap:10px;padding:5px 0}.field dt{font-weight:700;color:#415168}.field dd{margin:0;overflow-wrap:anywhere}.post-text,.exact pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6f8;border:1px solid #dce2e8;border-radius:9px;padding:12px;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.media{display:grid;grid-template-columns:minmax(130px,240px) 1fr;gap:14px;margin:10px 0}.media img{display:block;width:100%;height:auto;border-radius:9px;background:#e5e7eb}.none{color:#667085}.btns{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:20px}.btns form{margin:0}.btns button{width:100%;border-radius:11px;padding:15px;border:0;font-size:16px;font-weight:750;cursor:pointer}.approve{background:#2876e8;color:#fff}.reject{background:#351a22;color:#ff9bac;border:1px solid #7a2a2a!important}@media(max-width:620px){.media,.field{grid-template-columns:1fr}.btns{grid-template-columns:1fr}}`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="referrer" content="no-referrer"><title>GCD-SOCIAL — Exact payload review</title><style>${css}</style></head>
<body><main class="wrap">
  <header class="top"><h1>Review exact provider payload</h1><p>${esc(data.summary)}</p><p>Approval authorizes only the canonical payload and non-secret provider destination shown below. Any change to account, location, host, version, text, CTA, media, alt text, disclosure, language, scheduling, or another field requires a new approval. Access tokens are never included.</p></header>
  <section class="integrity">
    <div><strong>Subject type:</strong> <code>${esc(data.subjectType)}</code></div>
    <div><strong>Canonical SHA-256:</strong> <code data-payload-sha256>${esc(data.payloadSha256)}</code></div>
    <div><strong>Decision link expires:</strong> ${esc(data.tokenExpiresAt)}</div>
    <div><strong>Publication authorization expires:</strong> ${esc(data.authorizationExpiresAt)}</div>
  </section>
  ${cards}
  <details class="exact" open><summary><strong>Canonical provider payload JSON (authoritative)</strong></summary><pre data-canonical-payload>${esc(exactJson)}</pre></details>
  <div class="btns">
    <form method="POST" action="/approvals/${esc(data.id)}/decision"><input type="hidden" name="token" value="${esc(data.token)}"><input type="hidden" name="action" value="approve"><button class="approve">Approve exact payload</button></form>
    <form method="POST" action="/approvals/${esc(data.id)}/decision"><input type="hidden" name="token" value="${esc(data.token)}"><input type="hidden" name="action" value="reject"><button class="reject">Reject</button></form>
  </div>
</main></body></html>`;
}
