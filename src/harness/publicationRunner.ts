/**
 * The provider publication loop, with its durable safety markers.
 *
 * Extracted from the worker so every marker/side-effect ordering rule is
 * provable offline against injected boundaries, without a database, a network,
 * or a real provider.
 *
 * The invariant this file exists to enforce:
 *
 *   No provider side effect may begin unless its preceding started marker has
 *   durably committed, and no attempt is considered known unless its settled
 *   marker has durably committed.
 *
 * Outcomes are returned rather than thrown so the caller must handle each class
 * explicitly. An uncertain provider mutation in particular must never fall
 * through a generic failure path — it is its own outcome kind.
 */

import type { PostPackage, PlatformCredentials } from "../mcp/posting-tool/types.js";
import {
  PhaseMarkerPersistenceError,
  UncertainProviderOutcomeError,
  boundedErrorText,
  PHASE_PUBLISH_ATTEMPT_STARTED,
  PHASE_PUBLISH_ATTEMPT_SETTLED,
  PHASE_PUBLISH_ATTEMPT_ABANDONED,
} from "./briefRecovery.js";

export interface PublicationDeps {
  /** The sanctioned publication entrypoint. */
  publish(
    pkg: PostPackage,
    authorization: { approvalId: string; packageIndex: number },
    creds: PlatformCredentials,
  ): Promise<any>;
  /** Must reject if the marker did not commit. */
  recordDurablePhaseEvent(e: { runId?: string; kind: string; message: string; data?: unknown }): Promise<void>;
  /** Throws when ownership was lost or shutdown was requested. */
  assertSideEffectAllowed(operation: string): void;
  /** False once ownership is gone; gates the abandonment marker below. */
  ownershipHeld?: () => boolean;
}

export interface PublicationContext {
  runId: string;
  approvalId: string;
  payloads: PostPackage[];
  creds: PlatformCredentials;
}

export type PublicationOutcome =
  /** Every package was attempted and its outcome durably recorded. */
  | { kind: "settled"; results: any[] }
  /** A marker failed before any provider request for that package. */
  | { kind: "marker_failure"; error: PhaseMarkerPersistenceError; results: any[] }
  /** A provider reported success that could not be durably recorded. */
  | { kind: "uncertain"; error: UncertainProviderOutcomeError; results: any[] }
  /** Ownership was lost or shutdown began at a side-effect boundary. */
  | { kind: "interrupted"; error: Error; results: any[] };

export async function runPublication(
  deps: PublicationDeps,
  ctx: PublicationContext,
): Promise<PublicationOutcome> {
  const results: any[] = [];

  for (let packageIndex = 0; packageIndex < ctx.payloads.length; packageIndex++) {
    const payload = ctx.payloads[packageIndex]!;
    const platform = payload.platform;

    // Re-checked between platforms: ownership can be lost, or shutdown
    // requested, while an earlier platform was in flight.
    try {
      deps.assertSideEffectAllowed(`provider attempt for ${platform}`);
    } catch (err) {
      return { kind: "interrupted", error: err as Error, results };
    }

    try {
      await deps.recordDurablePhaseEvent({
        runId: ctx.runId,
        kind: PHASE_PUBLISH_ATTEMPT_STARTED,
        message: `provider attempt starting for ${platform}`,
        data: { approvalId: ctx.approvalId, packageIndex, platform },
      });
    } catch (err) {
      // The marker is not durable, so the provider must not be called at all:
      // an interruption during an unrecorded attempt would be indistinguishable
      // from never having attempted it.
      return {
        kind: "marker_failure",
        error: new PhaseMarkerPersistenceError(PHASE_PUBLISH_ATTEMPT_STARTED, err, packageIndex),
        results,
      };
    }

    // Second barrier. Committing the started marker is a database round trip
    // that can take seconds, and ownership can be lost inside that window. One
    // check before the marker is not enough: the provider request must be
    // guarded by a check taken as late as possible before it is issued.
    try {
      deps.assertSideEffectAllowed(`provider request for ${platform}`);
    } catch (err) {
      // The started marker is durable and is deliberately left in place -- it
      // is the truthful record that an attempt was opened. When ownership is
      // still held we can additionally prove the provider was never called, so
      // recovery can classify precisely instead of conservatively.
      if (deps.ownershipHeld?.() === true) {
        try {
          await deps.recordDurablePhaseEvent({
            runId: ctx.runId,
            kind: PHASE_PUBLISH_ATTEMPT_ABANDONED,
            message: `provider attempt abandoned before contact for ${platform}`,
            data: { approvalId: ctx.approvalId, packageIndex, platform, reason: "side_effects_blocked" },
          });
        } catch {
          // Without the abandonment marker recovery falls back to treating the
          // attempt as an unknown outcome, which is the safe direction.
        }
      }
      return { kind: "interrupted", error: err as Error, results };
    }

    let result: any;
    try {
      result = await deps.publish(payload, { approvalId: ctx.approvalId, packageIndex }, ctx.creds);
    } catch (err) {
      // An ordinary provider failure stays an ordinary per-platform failure;
      // it still gets a settled marker so recovery knows it was resolved.
      result = { platform, ok: false, error: boundedErrorText(err) };
    }

    const succeeded = result?.ok === true;
    try {
      await deps.recordDurablePhaseEvent({
        runId: ctx.runId,
        kind: PHASE_PUBLISH_ATTEMPT_SETTLED,
        message: `provider attempt settled for ${platform}`,
        data: {
          approvalId: ctx.approvalId,
          packageIndex,
          platform,
          ok: succeeded,
          ...(typeof result?.id === "string" ? { providerPostId: result.id } : {}),
          ...(succeeded ? {} : { error: boundedErrorText(result?.error) }),
        },
      });
    } catch (err) {
      if (succeeded) {
        // The post exists and durable state cannot prove it. Stop everything;
        // remaining platforms must not be attempted and nothing may retry.
        return {
          kind: "uncertain",
          error: new UncertainProviderOutcomeError(
            packageIndex,
            platform,
            typeof result?.id === "string" ? result.id : undefined,
            err,
          ),
          results,
        };
      }
      return {
        kind: "marker_failure",
        error: new PhaseMarkerPersistenceError(PHASE_PUBLISH_ATTEMPT_SETTLED, err, packageIndex),
        results,
      };
    }

    results.push(result);
  }

  return { kind: "settled", results };
}
