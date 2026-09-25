// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/local-files.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";

export const ReadLocalFileSchema = z.strictObject({
  path: z
    .string()
    .min(1)
    .max(4096)
    .describe("Absolute path or ~/ path on the user's machine. A directory lists its children."),
  offset: z.number().int().nonnegative().optional().describe("Byte offset for a text read, default 0."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(64000)
    .optional()
    .describe(
      "Maximum text bytes, default 64000. Images/PDFs use visual content; PDFs include the first 20 pages.",
    ),
});
export const ImportLocalFilesSchema = z.strictObject({
  path: z
    .string()
    .min(1)
    .max(4096)
    .describe("Absolute path or ~/ path of a file or directory on the user's machine."),
  targetWorkspaceId: z
    .uuid()
    .describe(
      "Explicit destination Sim workspace ID. In organization mode, discover accessible workspaces before choosing the destination.",
    ),
  folderId: z
    .uuid()
    .optional()
    .describe(
      "Optional existing destination folder ID. Directories retain their root folder and subdirectories.",
    ),
});
