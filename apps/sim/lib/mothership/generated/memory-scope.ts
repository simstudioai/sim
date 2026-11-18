// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/memory-scope.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";

export const MemoryScopeRequest = z.object({ chatId: z.uuid() });
export type MemoryScopeRequest = z.infer<typeof MemoryScopeRequest>;
export const MemoryScopeResponse = z.object({
  enabled: z.boolean().default(false),
  userId: z.string().min(1),
  organizationId: z.string().min(1).nullable(),
  workspaceId: z.uuid().nullable(),
  spaceId: z.uuid().nullable().optional(),
  /**
   * Sim's signature over this scope (an EdDSA JWT: `sub` the user, `org`, `ws`, `space`, `chat`;
   * one minute), sent while memory is enabled on a Sim with a signing key. The memory sidecar
   * verifies it, so who a memory request acts for never rests on the worker alone.
   */
  attestation: z.string().min(1).max(4096).optional(),
});
