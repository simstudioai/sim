// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/memory-scope.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";

export const MemoryScopeRequest = z.object({ chatId: z.uuid() });
export type MemoryScopeRequest = z.infer<typeof MemoryScopeRequest>;
export const MemoryScopeResponse = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1).nullable(),
  workspaceId: z.uuid().nullable(),
});
