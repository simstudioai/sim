// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/workbench.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";

/** Secret names explicitly requested for one workbench code call. Values never cross this wire. */
export const WorkbenchSecretNames = z.array(z.string().trim().min(1).max(1024)).max(100);

/** Executable bootstrap is served only on the authenticated Sim → worker connection. */
export const WorkbenchBootstrap = z.strictObject({
  version: z.literal(1),
  entrypoint: z.string().min(1).max(1_048_576),
});
export type WorkbenchBootstrap = z.infer<typeof WorkbenchBootstrap>;
