import { z } from 'zod'
import { booleanQueryFlagSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse, v2FolderPathInputSchema } from '@/lib/api/contracts/v2/shared'
import { v2WorkflowIdParamsSchema } from '@/lib/api/contracts/v2/workflows'
import {
  sourceBaseSchema,
  workflowLockSchema,
  workflowSourceQuerySchema,
  workflowSourceSchema,
} from '@/lib/api/contracts/workflow-source'

/** `GET /api/v2/workflows/{workflowId}/source`: the internal Code tab read, for API callers. */
export const v2GetWorkflowSourceContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[workflowId]/source',
  params: v2WorkflowIdParamsSchema,
  query: workflowSourceQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(workflowSourceSchema) },
})

const SOURCE_ENTRY_FILE = 'workflow.ts'
const MAX_SOURCE_FILES = 500

const applyWorkflowSourceQuerySchema = z
  .object({
    dryRun: booleanQueryFlagSchema
      .optional()
      .describe(
        'Run every check without writing, auditing, or notifying collaborators. Always answers `200`: errors are returned in `diagnostics` with `applied: false`, and the files, lock and fingerprint show what a committed apply would store.'
      ),
  })
  .strict()

const sourceFilesSchema = z
  .record(
    z
      .string()
      .min(1, 'files: a path cannot be empty')
      .max(512, 'files: a path cannot exceed 512 characters'),
    z.string()
  )
  .superRefine((files, ctx) => {
    if (!Object.hasOwn(files, SOURCE_ENTRY_FILE)) {
      ctx.addIssue({ code: 'custom', message: `files must include ${SOURCE_ENTRY_FILE}` })
    }
    if (Object.keys(files).length > MAX_SOURCE_FILES) {
      ctx.addIssue({ code: 'custom', message: `files cannot hold more than ${MAX_SOURCE_FILES}` })
    }
  })
  .describe(
    'Relative path → file text: `workflow.ts` plus every function-code file it references (for example `functions/score.js`).'
  )

const provenanceSchema = z
  .object({
    client: z
      .enum(['cli', 'copilot', 'canvas', 'api'], {
        error: 'provenance.client: expected one of "cli" | "copilot" | "canvas" | "api"',
      })
      .describe('What submitted the source.'),
    gitSha: z
      .string()
      .regex(/^[0-9a-f]{7,64}$/, 'provenance.gitSha must be a hexadecimal commit hash')
      .optional()
      .describe('The commit the source was taken from; recorded in the audit log.'),
    repo: z
      .string()
      .min(1, 'provenance.repo cannot be empty')
      .max(512, 'provenance.repo is too long')
      .optional()
      .describe('The repository the source was taken from.'),
  })
  .strict()
  .optional()
  .describe('Where the source came from, for the audit log.')

const applyWorkflowSourceBodySchema = z
  .object({
    files: sourceFilesSchema,
    lock: workflowLockSchema,
    base: sourceBaseSchema.describe(
      'Where and when the source was read (`.sim/base.json`). The apply answers `409` when the saved draft no longer matches `base.fingerprint`, and `400` when `base.workflowId` names another workflow.'
    ),
    provenance: provenanceSchema,
  })
  .strict()

const sourceDiagnosticSchema = z
  .object({
    code: z.string().describe('Diagnostic code, e.g. `E_UNKNOWN_PARAM` or `E_APPLY_LOCKED_BLOCK`.'),
    severity: z.enum(['error', 'warning', 'info']).describe('Diagnostic severity.'),
    message: z.string().describe('What was found.'),
    hint: z.string().optional().describe('How to address it.'),
    file: z.string().optional().describe('Submitted file the finding is in.'),
    line: z.number().int().optional().describe('1-based line in `file`.'),
    column: z.number().int().optional().describe('1-based column in `file`.'),
    endLine: z.number().int().optional().describe('1-based line the finding ends on.'),
    endColumn: z.number().int().optional().describe('1-based column the finding ends at.'),
    frame: z.string().optional().describe('The source lines around the finding, with a caret row.'),
    blockKey: z.string().optional().describe('Block key the finding is about.'),
    blockId: z.string().optional().describe('Stored id of the block the finding is about.'),
    param: z.string().optional().describe('Field the finding is about.'),
    path: z.string().optional().describe('JSON Pointer into the lock, for a lock finding.'),
  })
  .describe('A finding from applying workflow source, pinned to the submitted files.')

const blockRefSchema = z
  .object({
    id: z.string().describe('Stored block id.'),
    key: z.string().describe('Block key in the source.'),
  })
  .describe('A block by id and source key.')

const sourceDiffSchema = z
  .object({
    noop: z.boolean().describe('True when the source matches the saved draft.'),
    blocks: z
      .object({
        added: z.array(blockRefSchema).describe('New blocks.'),
        removed: z.array(blockRefSchema).describe('Deleted blocks.'),
        renamed: z
          .array(
            z
              .object({
                id: z.string().describe('Stored block id; unchanged by the rename.'),
                from: z.string().describe('Previous key.'),
                to: z.string().describe('New key.'),
              })
              .describe('A renamed block.')
          )
          .describe('Renamed blocks; each keeps its id.'),
        modified: z
          .array(
            blockRefSchema
              .extend({
                fields: z
                  .array(z.string())
                  .describe('Changed fields, modes (`modes.<param>`) and attributes.'),
                reparented: z.boolean().optional().describe('Moved into or out of a container.'),
              })
              .describe('A changed block.')
          )
          .describe('Changed blocks.'),
      })
      .describe('Block changes.'),
    edges: z
      .object({
        added: z.number().int().describe('Connections added.'),
        removed: z.number().int().describe('Connections removed.'),
      })
      .describe('Connection changes.'),
    variables: z
      .object({
        added: z.array(z.string()).describe('Variable keys added.'),
        removed: z.array(z.string()).describe('Variable keys removed.'),
        modified: z.array(z.string()).describe('Variable keys changed.'),
      })
      .describe('Variable changes.'),
  })
  .describe('What the apply changed, or would change on a dry run.')

const applyWorkflowSourceDataSchema = z
  .object({
    workflowId: z.string().describe('Workflow id.'),
    workspaceId: z.string().describe('Workspace id.'),
    dryRun: z.boolean().describe('True when nothing was written because `dryRun` was set.'),
    applied: z
      .boolean()
      .describe('True only when the draft was written; false on a dry run and on a no-op.'),
    diff: sourceDiffSchema,
    diagnostics: z
      .array(sourceDiagnosticSchema)
      .describe('Warnings, and on a dry run every error a commit would refuse.'),
    fingerprint: z
      .string()
      .describe(
        'Fingerprint of the saved (or, on a dry run, would-be) draft: the next `base.fingerprint`.'
      ),
    files: z
      .record(z.string(), z.string())
      .describe('The source re-printed from what was saved, including any normalized values.'),
    lock: workflowLockSchema,
    base: sourceBaseSchema,
    mintedIds: z
      .record(z.string(), z.string())
      .describe(
        'Block key → id for new blocks whose id was minted rather than taken from the lock.'
      ),
    notes: z.array(z.string()).describe('Non-fatal notes about the write.'),
    needsRedeployment: z
      .boolean()
      .describe('Whether the draft now differs from the live deployment; apply never deploys.'),
  })
  .describe('The outcome of applying workflow source.')

/** `POST /api/v2/workflows/{workflowId}/source`: write TypeScript source to the draft graph. */
export const v2ApplyWorkflowSourceContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[workflowId]/source',
  params: v2WorkflowIdParamsSchema,
  query: applyWorkflowSourceQuerySchema,
  body: applyWorkflowSourceBodySchema,
  response: { mode: 'json', schema: v2DataResponse(applyWorkflowSourceDataSchema) },
})

const createWorkflowFromSourceParamsSchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace in which to create the workflow.'),
  })
  .strict()

const createWorkflowFromSourceBodySchema = z
  .object({
    files: sourceFilesSchema,
    name: z
      .string()
      .trim()
      .min(1, 'name cannot be empty')
      .max(255, 'name is too long')
      .optional()
      .describe("Workflow name. Defaults to the name in the source's `workflow('…')` call."),
    description: z
      .string()
      .max(50_000, 'description is too long')
      .nullable()
      .optional()
      .describe('Workflow description. Defaults to the description in the source.'),
    folderPath: v2FolderPathInputSchema.optional(),
    provenance: provenanceSchema,
  })
  .strict()

/**
 * `POST /api/v2/workspaces/{workspaceId}/workflows/source`: create a workflow from TypeScript
 * source, through the same checks as an apply.
 */
export const v2CreateWorkflowFromSourceContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workspaces/[workspaceId]/workflows/source',
  params: createWorkflowFromSourceParamsSchema,
  query: applyWorkflowSourceQuerySchema,
  body: createWorkflowFromSourceBodySchema,
  response: { mode: 'json', schema: v2DataResponse(applyWorkflowSourceDataSchema) },
})
