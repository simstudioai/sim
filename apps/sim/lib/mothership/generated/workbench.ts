// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/workbench.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";

/** Executable bootstrap is served only on the authenticated Sim → worker connection. */
export const WorkbenchBootstrap = z.strictObject({
  version: z.literal(1),
  entrypoint: z.string().min(1).max(65_536),
});
export type WorkbenchBootstrap = z.infer<typeof WorkbenchBootstrap>;
