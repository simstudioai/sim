// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/model-router.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";

/**
 * POST /api/model-router: the stateless classifier Sim calls before running a block whose model
 * is "auto". Sim sends compact signals about the pending task and its ordered candidates; the
 * worker answers with one candidate id. Sim owns what the ids mean and which model serves each.
 * Internal-key only: customer keys never reach it.
 */
export const ModelRouterCandidate = z.strictObject({
  /**
   * The token the classifier answers with, e.g. "1": ASCII letters, digits, `_` and `-`, starting
   * and ending with a letter or digit. Edge punctuation is reserved for the wrapping a model puts
   * around its answer (`"2".`, `**fast**`), so the worker strips it without ever turning one
   * candidate's id into another's.
   */
  id: z
    .string()
    .max(32)
    .regex(
      /^[A-Za-z0-9](?:[\w-]*[A-Za-z0-9])?$/,
      "a candidate id is letters, digits, _ and -, starting and ending with a letter or digit",
    ),
  /** One line saying when this candidate fits. */
  hint: z.string().max(500),
});
export type ModelRouterCandidate = z.infer<typeof ModelRouterCandidate>;

/** Signals, never payloads: the text fields are excerpts of untrusted user content. */
export const ModelRouterSignals = z.strictObject({
  systemPrompt: z.string().optional(),
  lastMessage: z.string().optional(),
  messageCount: z.number().int().nonnegative().optional(),
  toolNames: z.array(z.string()).optional(),
  hasMedia: z.boolean().optional(),
  hasResponseFormat: z.boolean().optional(),
  approxInputTokens: z.number().int().nonnegative().optional(),
});
export type ModelRouterSignals = z.infer<typeof ModelRouterSignals>;

export const ModelRouterRequest = z.strictObject({
  signals: ModelRouterSignals,
  /** Ascending by capability and cost; ties break toward the later candidate. */
  candidates: z
    .array(ModelRouterCandidate)
    .min(2)
    .max(8)
    .refine(
      (candidates) => new Set(candidates.map((c) => c.id.toLowerCase())).size === candidates.length,
      "candidate ids must be unique",
    ),
  /** Attribution for metering only; never part of the decision. */
  workspaceId: z.string().max(200).optional(),
  userId: z.string().max(200).optional(),
  workflowId: z.string().max(200).optional(),
  blockId: z.string().max(200).optional(),
  executionId: z.string().max(200).optional(),
});
export type ModelRouterRequest = z.infer<typeof ModelRouterRequest>;

/** "llm": the classifier named a candidate. "fallback": it did not, so the upper-middle
 * candidate was chosen; the call still ran and its usage is still reported. */
export type ModelRouterDecidedBy = "llm" | "fallback";

/** The classifier call's own usage and list-price cost in USD, priced from the worker's catalog. */
export interface ModelRouterUsage {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface ModelRouterResponse {
  choice: string;
  decidedBy: ModelRouterDecidedBy;
  usage: ModelRouterUsage;
  /** Whether Sim charges the user for this call. Sim treats a missing or false value as no. */
  billable: boolean;
}
