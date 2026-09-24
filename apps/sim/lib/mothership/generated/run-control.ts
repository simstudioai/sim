// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/run-control.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";

export const RunControlRequest = z.object({
  chatId: z.string().uuid(),
  streamId: z.string().min(1).max(200),
});
export type RunControlRequest = z.infer<typeof RunControlRequest>;

export const RunControlState = z.object({ stopped: z.boolean() });
export type RunControlState = z.infer<typeof RunControlState>;
