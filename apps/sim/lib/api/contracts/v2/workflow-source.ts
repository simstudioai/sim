import { DIAGNOSTIC_CODES } from '@sim/workflow-code/diagnostics/codes'
import { SOURCE_ENTRY_FILE, SOURCE_LIMITS } from '@sim/workflow-code/limits'
import { z } from 'zod'
import { booleanQueryFlagSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse, v2FolderPathInputSchema } from '@/lib/api/contracts/v2/shared'
import { v2WorkflowIdParamsSchema } from '@/lib/api/contracts/v2/workflows'
import {
  sourceBaseSchema,
  sourceReadDiagnosticSchema,
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

const applyWorkflowSourceQuerySchema = z
  .object({
    dryRun: booleanQueryFlagSchema
      .optional()
      .describe(
        'Run every check without writing, auditing, or notifying collaborators. Findings, errors included, come back in `diagnostics` with `applied: false` and a `200`, and the files, lock and fingerprint show what a committed apply would store. A request refused before the source is evaluated (an invalid or oversized body, a locked workflow or folder) gets the same status as without `dryRun`, and a create under a taken name answers `409`.'
      ),
    allowDelete: booleanQueryFlagSchema
      .optional()
      .describe(
        'Allow the apply to delete blocks and variables the source no longer declares. Without it, an apply that would delete any block is refused with `E_APPLY_BLOCK_DELETE`, and one that would delete any variable with `E_APPLY_VARIABLE_DELETE`, naming them. Ignored when creating a workflow.'
      ),
  })
  .strict()

/** Longest path a source file may have, in a workflow's source and in a workspace's alike. */
export const SOURCE_PATH_MAX_LENGTH = 1024

const sourceFilesSchema = z
  .record(
    z
      .string()
      .min(1, 'files: a path cannot be empty')
      .max(
        SOURCE_PATH_MAX_LENGTH,
        `files: a path cannot exceed ${SOURCE_PATH_MAX_LENGTH} characters`
      ),
    z.string()
  )
  .superRefine((files, ctx) => {
    if (!Object.hasOwn(files, SOURCE_ENTRY_FILE)) {
      ctx.addIssue({ code: 'custom', message: `files must include ${SOURCE_ENTRY_FILE}` })
    }
    if (Object.keys(files).length > SOURCE_LIMITS.maxFiles) {
      ctx.addIssue({
        code: 'custom',
        message: `files cannot hold more than ${SOURCE_LIMITS.maxFiles}`,
      })
    }
  })
  .describe(
    `Relative path → file text: \`workflow.ts\` plus every function-code file it references (for example \`functions/score.js\`). At most ${SOURCE_LIMITS.maxFiles} files and ${SOURCE_LIMITS.maxTotalBytes} bytes together, for a workflow of at most ${SOURCE_LIMITS.maxBlocks} blocks.`
  )

/**
 * Whether a repository address carries credentials, judged by parsing it rather than matching
 * one shape: a URL (`scheme://…`) that does not parse, holds a query, a fragment, a password, or
 * any user on an HTTP(S) transport (`git+https://token@…` included); or any other address holding
 * a query or fragment, a `scheme:` or `scheme:/` form with a user (`https:/token@host`, which a
 * URL parser reads as `https://token@host`), or an scp-style address (`user@host:path`) whose
 * user holds a password. Whitespace and control characters are refused outright, so no padding
 * hides the address from the parser.
 */
function carriesCredentials(repo: string): boolean {
  if (/[\s\p{Cc}]/u.test(repo)) return true
  if (!repo.includes('://')) {
    return (
      /[?#]/.test(repo) ||
      /^[a-z][a-z0-9+.-]*:\/*[^/@]*@/i.test(repo) ||
      /^[^@/]*:[^@/]*@/.test(repo)
    )
  }
  let url: URL
  try {
    url = new URL(repo)
  } catch {
    return true
  }
  if (url.password !== '' || url.search !== '' || url.hash !== '') return true
  return url.username !== '' && /(^|\+)https?:$/i.test(url.protocol)
}

/** `provenance.gitSha`: the commit a source or directory was taken from. */
export const provenanceGitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{7,64}$/, 'provenance.gitSha must be a hexadecimal commit hash')

/** `provenance.repo`: the repository a source or directory was taken from, never with credentials. */
export const provenanceRepoSchema = z
  .string()
  .min(1, 'provenance.repo cannot be empty')
  .max(512, 'provenance.repo is too long')
  .refine((repo) => !carriesCredentials(repo), {
    message:
      'provenance.repo must not carry credentials: send the URL without its user, password and query',
  })
  .describe('The repository the source was taken from (its remote URL); recorded in the audit log.')

const provenanceSchema = z
  .object({
    client: z
      .enum(['cli', 'copilot', 'canvas', 'api'], {
        error: 'provenance.client: expected one of "cli" | "copilot" | "canvas" | "api"',
      })
      .describe('What submitted the source.'),
    gitSha: provenanceGitShaSchema
      .optional()
      .describe('The commit the source was taken from; recorded in the audit log.'),
    repo: provenanceRepoSchema.optional(),
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

const sourceDiagnosticSchema = sourceReadDiagnosticSchema
  .extend({
    code: z
      .enum(DIAGNOSTIC_CODES)
      .describe('Diagnostic code, e.g. `E_UNKNOWN_PARAM` or `E_APPLY_LOCKED_BLOCK`.'),
    file: z.string().optional().describe('Submitted file the finding is in.'),
    line: z.number().int().optional().describe('1-based line in `file`.'),
    column: z.number().int().optional().describe('1-based column in `file`.'),
    endLine: z.number().int().optional().describe('1-based line the finding ends on.'),
    endColumn: z.number().int().optional().describe('1-based column the finding ends at.'),
    frame: z.string().optional().describe('The source lines around the finding, with a caret row.'),
    blockId: z.string().optional().describe('Stored id of the block the finding is about.'),
    path: z.string().optional().describe('JSON Pointer into the lock, for a lock finding.'),
  })
  .describe('A finding from applying workflow source, pinned to the submitted files.')

const blockRefSchema = z
  .object({
    id: z.string().describe('Stored block id.'),
    key: z.string().describe('Block key in the source.'),
  })
  .describe('A block by id and source key.')

const typedBlockRefSchema = blockRefSchema
  .extend({ type: z.string().describe('Block type.') })
  .describe('An added or removed block by id, source key and type.')

const sourceDiffSchema = z
  .object({
    noop: z.boolean().describe('True when the source matches the saved draft.'),
    meta: z
      .array(z.enum(['name', 'description']))
      .optional()
      .describe('The workflow name and description fields the source changes.'),
    blocks: z
      .object({
        added: z.array(typedBlockRefSchema).describe('New blocks.'),
        removed: z.array(typedBlockRefSchema).describe('Deleted blocks.'),
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
        renamed: z
          .array(
            z
              .object({
                from: z.string().describe('Former key.'),
                to: z.string().describe('New key.'),
              })
              .describe('A renamed variable.')
          )
          .describe('Variables renamed; each keeps its id, so none is deleted.'),
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
      .describe(
        'True when the draft was written or the workflow renamed or redescribed; false on a dry run and on a no-op.'
      ),
    diff: sourceDiffSchema,
    diagnostics: z
      .array(sourceDiagnosticSchema)
      .describe('Warnings, and on a dry run every error a commit would refuse.'),
    files: z
      .record(z.string(), z.string())
      .describe('The source re-printed from what was saved, including any normalized values.'),
    lock: workflowLockSchema,
    base: sourceBaseSchema.describe(
      'Where the saved (or, on a dry run, would-be) draft was read: the next apply’s `base`.'
    ),
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

const planWorkflowSourceQuerySchema = z
  .object({
    allowDelete: booleanQueryFlagSchema
      .optional()
      .describe(
        'Plan the deletes of blocks and variables the source no longer declares as an apply with `allowDelete` would, listing them in the diff, instead of reporting `E_APPLY_BLOCK_DELETE` or `E_APPLY_VARIABLE_DELETE`.'
      ),
  })
  .strict()

const planWorkflowSourceBodySchema = z
  .object({
    files: sourceFilesSchema,
    lock: workflowLockSchema,
    base: sourceBaseSchema.describe(
      'Where and when the source was read (`.sim/base.json`). A draft that no longer matches `base.fingerprint` is reported as `E_APPLY_STALE` in `diagnostics`.'
    ),
  })
  .strict()

/**
 * `POST /api/v2/workflows/{workflowId}/source/plan`: what applying the source would do, as a read.
 * The response is an apply dry run's.
 */
export const v2PlanWorkflowSourceContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[workflowId]/source/plan',
  params: v2WorkflowIdParamsSchema,
  query: planWorkflowSourceQuerySchema,
  body: planWorkflowSourceBodySchema,
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
