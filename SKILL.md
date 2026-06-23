---
name: self-improvement-protocol
description: Governs how GCD-SOCIAL agents propose improvements to their own prompts, skills, and processes. Enforces propose-don't-apply, append-only guardrails, and a core-objective lock. Load whenever an agent detects a weakness in its own configuration or wants to suggest a change.
---

# Self-Improvement Protocol

This skill defines the ONLY sanctioned way GCD-SOCIAL agents may change themselves. It exists because autonomous systems that edit their own guardrails are dangerous. The architecture is **propose, don't apply**.

## Hard rules (never overridden)

1. **Propose, don't apply.** An agent may *write a proposal*. It may never modify its own prompt, a skill file, a hook, an MCP config, the approval gate, or any deny-rule directly. Application happens only after human approval.
2. **Append-only guardrails.** Base guardrails (the approval gate, posting deny-rules, claims rules, instruction-source boundary, child/public-safety rules) can be *added to* but never weakened or removed — not even by an approved proposal. A proposal that would remove or loosen a guardrail is auto-rejected.
3. **Core-objective lock.** No proposal may alter the system's core objective (create on-brand, compliant GCD social posts under human-defined autonomy) or its safety constraints. Any such attempt triggers mandatory human review and is logged as a high-severity event.
4. **Traceable lineage.** Every proposal records: what it changes, why (with evidence), the risk tier, the proposing agent, and a parent reference to the version it modifies. No anonymous or untraceable changes.
5. **Re-scan after change.** Any approved change is re-scanned by AgentShield before it goes live. A change that introduces a new finding is rolled back.

## Proposal lifecycle

1. **Detect** — an agent notices a recurring failure, a brittle instruction, or a better pattern (e.g., the copywriter keeps tripping the em-dash rule; a platform spec changed).
2. **Draft** — write a proposal in the format below. Do not change any file.
3. **Score** — assign a confidence score and risk tier (see below).
4. **Queue** — append to the proposal queue (`state: pending`). Notify the human via `ApprovalChannel`.
5. **Review** — human approves, edits, or rejects. Low-risk changes may use automated checks + AI review; medium/high-risk REQUIRE a human.
6. **Promote** — on approval, the change is applied by the human (or a privileged, separate process), AgentShield re-scans, and the lineage record closes.

## Risk tiers

- **Low** — wording tweaks to a worker prompt, a new approved phrase, a hashtag set. Automated check + AI review may suffice.
- **Medium** — new skill, changed critique threshold, model-routing change. Human approval required.
- **High** — anything touching the approval gate, deny-rules, guardrails, MCP/tool scope, or the core objective. Human approval required; default stance is reject. Most of these should never be proposed at all (see Hard rule 2 & 3).

## Proposal format

```yaml
proposal_id: <uuid>
created: <iso8601>
proposing_agent: <agent-name>
parent_version: <file@sha or prompt-version>
target: <which file/prompt/skill>
risk_tier: low | medium | high
change_summary: <one sentence>
rationale: <evidence — which runs/metrics motivated this>
proposed_diff: |
  <the exact change>
guardrail_impact: none | adds-guardrail | (loosens-guardrail → AUTO-REJECT)
status: pending | approved | rejected | applied | rolled-back
```

## Seed source
Adapted from ECC `continuous-learning-v2` (instinct extraction → confidence scoring → `/evolve` into skills). The instinct-extraction and confidence-scoring mechanics carry over; the propose-don't-apply gate, append-only rule, and core-objective lock are GCD-SOCIAL additions and take precedence over any upstream behavior.
