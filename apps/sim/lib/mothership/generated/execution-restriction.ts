// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/execution-restriction.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";

/** Server-authored v1 permits reviewed stored workspace reads, never live credentials. */
export const ExternalMailerRestriction = z.strictObject({
  version: z.literal(1),
  kind: z.literal("external_mailer"),
  admissionId: z.string().min(1),
  inboxTaskId: z.string().min(1),
  workspaceId: z.string().min(1),
});
export type ExternalMailerRestriction = z.infer<typeof ExternalMailerRestriction>;
