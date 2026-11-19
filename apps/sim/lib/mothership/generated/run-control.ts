// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/run-control.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";

/** Sim's run grant (`RUN_GRANT_HEADER` in sim-transport): a token the worker returns, never reads. */
export const RunGrant = z.string().min(1).max(4096);

export const RunControlRequest = z.object({
  chatId: z.string().uuid(),
  streamId: z.string().min(1).max(200),
});
export type RunControlRequest = z.infer<typeof RunControlRequest>;

export const RunControlState = z.object({
  stopped: z.boolean(),
  /**
   * A fresh run grant for the same user and chat, sent when the grant the call carried is past
   * half its life: a run that keeps checking its control keeps a valid grant however long it
   * runs. The worker uses it from its next call on.
   */
  grant: RunGrant.optional(),
});
export type RunControlState = z.infer<typeof RunControlState>;
