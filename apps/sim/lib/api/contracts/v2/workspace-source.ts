import { DIAGNOSTIC_CODES } from '@sim/workflow-code/diagnostics/codes'
import { APPLY_ORDER } from '@sim/workspace-code'
import { WORKSPACE_DIAGNOSTIC_CODES } from '@sim/workspace-code/diagnostics/codes'
import { isWorkspaceSourcePath } from '@sim/workspace-code/layout'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { z } from 'zod'
import {
  booleanQueryFlagSchema,
  noInputSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'
import {
  provenanceGitShaSchema,
  provenanceRepoSchema,
  SOURCE_PATH_MAX_LENGTH,
} from '@/lib/api/contracts/v2/workflow-source'

const kindSchema = z
  .enum(APPLY_ORDER, {
    error: `kind: expected one of ${APPLY_ORDER.map((kind) => `"${kind}"`).join(' | ')}`,
  })
  .describe(`A resource kind: ${APPLY_ORDER.map((kind) => `\`${kind}\``).join(', ')}.`)

const paramsSchema = z
  .object({ workspaceId: workspaceIdSchema.describe('Workspace to read or apply.') })
  .strict()

const getQuerySchema = z
  .object({
    kinds: z
      .string()
      .min(1, 'kinds cannot be empty')
      .transform((value) => value.split(',').map((kind) => kind.trim()))
      .pipe(
        z
          .array(kindSchema)
          .refine(
            (kinds) => new Set(kinds).size === kinds.length,
            'kinds lists each kind at most once'
          )
      )
      .optional()
      .describe('Comma-separated kinds to read; every kind the server supports when omitted.'),
  })
  .strict()

const pathSchema = z
  .string()
  .min(1, 'a path cannot be empty')
  .max(SOURCE_PATH_MAX_LENGTH, `a path cannot exceed ${SOURCE_PATH_MAX_LENGTH} characters`)
  .refine(
    isWorkspaceSourcePath,
    "a path must sit inside a kind folder (or be a kind's root file), with no `.` or `..` segments"
  )

const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 lowercase hex digits')
  .describe('SHA-256 of the bytes, lowercase hex.')

/** A workspace finding's code, or a workflow folder's own (the workflow pipeline's codes). */
const diagnosticCodeSchema = z.enum([...WORKSPACE_DIAGNOSTIC_CODES, ...DIAGNOSTIC_CODES])

const diagnosticSchema = z
  .object({
    code: diagnosticCodeSchema.describe(
      'Diagnostic code, e.g. `E_APPLY_STALE` or `E_UNKNOWN_PARAM`.'
    ),
    severity: z.enum(['error', 'warning', 'info']).describe('Diagnostic severity.'),
    message: z.string().describe('What was found.'),
    hint: z.string().optional().describe('How to address it.'),
    file: z.string().optional().describe('Directory file the finding is in.'),
    line: z.number().int().optional().describe('1-based line in `file`.'),
    column: z.number().int().optional().describe('1-based column in `file`.'),
    endLine: z.number().int().optional().describe('1-based line the finding ends on.'),
    endColumn: z.number().int().optional().describe('1-based column the finding ends at.'),
    frame: z.string().optional().describe('The source lines around the finding, with a caret row.'),
    path: z.string().optional().describe('JSON Pointer into a JSON file, such as the base.'),
    kind: z.string().optional().describe('Kind of the resource the finding is about.'),
    key: z.string().optional().describe('Key of the resource the finding is about.'),
    blockKey: z.string().optional().describe('Workflow block the finding is about.'),
    param: z.string().optional().describe('Block field the finding is about.'),
  })
  .describe('A finding about the directory, pinned to its file when it has one.')

/** An `x-` field of the base: data the format does not define, kept as written. */
const extensionSchema = z.unknown().describe('An `x-` extension field, kept as written.')

const baseResourceSchema = z
  .object({
    id: z.string().describe('Stored id the key is bound to.'),
    fingerprint: z
      .string()
      .optional()
      .describe(
        '`rf1:` fingerprint of the resource as last read; absent for a workflow, and for a binary file listed without `sha256` until the client records its hash.'
      ),
    columns: z
      .record(
        z.string(),
        z.object({
          id: z.string().describe('Stored column id.'),
          options: z
            .record(z.string(), z.string())
            .optional()
            .describe('Select option name → option id.'),
        })
      )
      .optional()
      .describe('Table column key → stored column.'),
    blobs: z
      .record(
        z.string(),
        z.object({
          id: z.string().describe('Stored id of the binary file.'),
          rev: z.union([z.number().int(), z.string()]).describe('Content revision as last read.'),
          sha256: sha256Schema,
        })
      )
      .optional()
      .describe('Binary file name → its stored id, revision and hash as last read.'),
    rows: z
      .object({
        fingerprint: z.string().describe('`rf1:` fingerprint of the managed rows as last read.'),
        version: z
          .number()
          .int()
          .nonnegative()
          .describe('The table’s row version as last read; it moves on every row write.'),
      })
      .catchall(extensionSchema)
      .optional()
      .describe('A table’s managed rows, as last read.'),
  })
  .catchall(extensionSchema)
  .describe('One resource in the base.')

const baseSchema = z
  .object({
    version: z.literal(1).describe('Base format version.'),
    workspaceId: z.string().describe('Workspace the directory was read from.'),
    resources: z
      .record(z.string(), baseResourceSchema)
      .describe('`kind:key` → the stored resource and its fingerprint.'),
  })
  .catchall(extensionSchema)
  .describe(
    '`.sim/base.json`: per resource, the id and fingerprint the directory was read at. Apply compares it with the server to tell a local edit from a server change.'
  )

const blobSchema = z
  .object({
    path: pathSchema.describe('Directory path of the binary file.'),
    sha256: sha256Schema,
    size: z
      .number()
      .int()
      .min(0)
      .max(
        WORKSPACE_SOURCE_LIMITS.maxBlobBytes,
        `size cannot exceed ${WORKSPACE_SOURCE_LIMITS.maxBlobBytes}`
      )
      .describe('Bytes.'),
  })
  .strict()

const changeSchema = z
  .object({
    kind: kindSchema,
    key: z.string().describe('Resource key.'),
    action: z
      .enum(['create', 'update', 'adopt', 'delete', 'noop'])
      .describe('`adopt` binds the key to an existing resource of the same name, then updates it.'),
    fields: z.array(z.string()).optional().describe('What changes.'),
    destructive: z
      .object({
        what: z.string().describe('What is lost.'),
        counts: z.record(z.string(), z.number().int()).describe('How much is lost.'),
      })
      .optional()
      .describe(
        'Data the change deletes: dropped columns, removed select options and the cells they empty, or a deleted resource. A dry run shows it whether or not `allowDelete` is set.'
      ),
    id: z.string().optional().describe('Stored id, once known.'),
    held: z
      .literal(true)
      .optional()
      .describe(
        'Held back: the change uses a declared secret the workspace has no value for, or a declared credential key nothing binds to (see its errors). It is not written; the rest of the apply goes ahead.'
      ),
  })
  .describe('One planned or applied change.')

const readDataSchema = z
  .object({
    workspaceId: z.string().describe('Workspace id.'),
    kinds: z.array(kindSchema).describe('The kinds read; the directory manages exactly these.'),
    files: z.record(z.string(), z.string()).describe('Directory path → file text.'),
    blobs: z
      .array(
        blobSchema.extend({
          sha256: sha256Schema
            .optional()
            .describe(
              'Absent when the server did not hash the bytes within the request; hash the downloaded bytes and record them in the base with `id` and `rev`.'
            ),
          id: z.string().describe('Stored id of the binary file.'),
          href: z.string().describe('Where to download its bytes.'),
          rev: z.string().optional().describe('Content revision, present when `sha256` is absent.'),
        })
      )
      .describe('Binary files, downloaded separately by `href`.'),
    base: baseSchema,
    skipped: z
      .array(
        z.object({
          kind: kindSchema,
          key: z.string().describe('Resource key.'),
          reason: z.string().describe('Why it was left out.'),
        })
      )
      .describe(
        "Resources left out, with why: too large to read as source, not readable by the caller, or past the directory's declaration or binary-file budget."
      ),
    diagnostics: z.array(diagnosticSchema).describe('Findings from reading.'),
  })
  .describe('A workspace as source.')

/** `GET /api/v2/workspaces/{workspaceId}/source`: the workspace as a source directory. */
export const v2GetWorkspaceSourceContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workspaces/[workspaceId]/source',
  params: paramsSchema,
  query: getQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(readDataSchema) },
})

const applyQuerySchema = z
  .object({
    dryRun: booleanQueryFlagSchema
      .optional()
      .describe(
        'Plan, check and authorize every change without writing. Findings, errors included, come back in `diagnostics` with a `200`.'
      ),
  })
  .strict()

const applyBodySchema = z
  .object({
    files: z
      .record(pathSchema, z.string())
      .describe(
        'Directory path → text for every managed kind: declarations (`tables/leads.ts`) and workflow folders (`workflows/ingest/workflow.ts`, `functions/*`, `.sim/lock.json`, `.sim/base.json`). A workflow folder sent with only its `.sim/base.json` is unchanged.'
      ),
    blobs: z
      .array(blobSchema)
      .max(
        WORKSPACE_SOURCE_LIMITS.maxBlobs,
        `blobs cannot list more than ${WORKSPACE_SOURCE_LIMITS.maxBlobs} files`
      )
      .optional()
      .describe(
        'Binary files by path, with the SHA-256 and size of their bytes. Their bytes must be staged first: `sim workspaces source apply` stages them, or upload them to `POST /api/v2/workspaces/{workspaceId}/source/blobs` (not available over MCP). An apply with any missing is refused with `E_BLOB_MISSING` and writes nothing.'
      ),
    base: baseSchema.optional(),
    kinds: z
      .array(kindSchema)
      .max(APPLY_ORDER.length)
      .describe(
        'The kind folders the directory holds, empty ones included. A kind is managed only when listed here or when a file of it is sent.'
      ),
    options: z
      .object({
        allowDelete: z
          .boolean()
          .optional()
          .describe('Delete resources, columns and data the directory no longer declares.'),
        only: z.array(kindSchema).optional().describe('Apply only these kinds.'),
      })
      .strict()
      .optional()
      .describe('How far the apply may go.'),
    provenance: z
      .object({
        client: z.enum(['cli', 'api']).describe('What submitted the directory.'),
        gitSha: provenanceGitShaSchema
          .optional()
          .describe('The commit the directory was taken from; recorded in the audit log.'),
        repo: provenanceRepoSchema.optional(),
      })
      .strict()
      .optional()
      .describe('Where the directory came from, for the audit log.'),
  })
  .strict()

const applyDataSchema = z
  .object({
    workspaceId: z.string().describe('Workspace id.'),
    dryRun: z.boolean().describe('True when nothing was written because `dryRun` was set.'),
    plan: z.array(changeSchema).describe('Every planned change, no-ops included, in apply order.'),
    refuses: z
      .boolean()
      .optional()
      .describe(
        'Set on a dry run: whether the apply would refuse. Errors of a change held back (`held`) refuse nothing else; any other error refuses. Absent on an apply.'
      ),
    applied: z.array(changeSchema).describe('The changes written, in order.'),
    failed: z
      .object({
        kind: kindSchema,
        key: z.string().describe('Resource key.'),
        code: diagnosticCodeSchema.describe('Diagnostic code.'),
        message: z.string().describe('What failed.'),
      })
      .optional()
      .describe(
        'The change that failed mid-apply. The changes before it are written (`applied`); the rest were not attempted. Applying the same directory again continues.'
      ),
    needBlobs: z
      .array(z.string())
      .describe(
        'Binary paths a write needs whose bytes are not staged: on a dry run, exactly what to stage before applying.'
      ),
    applyId: z
      .string()
      .optional()
      .describe(
        'The id of an apply that wrote: every audit log entry its writes recorded carries it as `metadata.correlationId`. Absent on a dry run.'
      ),
    files: z
      .record(z.string(), z.string())
      .describe('Files re-printed from what was saved, for every resource written.'),
    base: baseSchema.describe('The base after this apply: the next apply’s `base`.'),
    diagnostics: z.array(diagnosticSchema).describe('Warnings, and on a dry run every error.'),
  })
  .describe('The outcome of applying workspace source.')

/** `POST /api/v2/workspaces/{workspaceId}/source`: apply a workspace source directory. */
export const v2ApplyWorkspaceSourceContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workspaces/[workspaceId]/source',
  params: paramsSchema,
  query: applyQuerySchema,
  body: applyBodySchema,
  response: { mode: 'json', schema: v2DataResponse(applyDataSchema) },
})

/**
 * `POST /api/v2/workspaces/{workspaceId}/source/plan`: what applying the directory would do, as a
 * read. The body is an apply's without `provenance`; the response is an apply dry run's.
 */
export const v2PlanWorkspaceSourceContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workspaces/[workspaceId]/source/plan',
  params: paramsSchema,
  query: noInputSchema,
  body: applyBodySchema.omit({ provenance: true }),
  response: { mode: 'json', schema: v2DataResponse(applyDataSchema) },
})

const stagedBlobSchema = z
  .object({ sha256: sha256Schema, size: blobSchema.shape.size })
  .strict()
  .describe('A binary file by the SHA-256 and size of its bytes.')

/**
 * The multipart form a staging request sends: one file part per blob, its field name the
 * SHA-256 of its bytes.
 */
export const v2StageWorkspaceSourceBlobsFormSchema = z
  .record(
    sha256Schema.describe('The SHA-256 of the part, lowercase hex.'),
    z.file().max(WORKSPACE_SOURCE_LIMITS.maxBlobBytes).describe('The bytes of one binary file.')
  )
  .describe(
    `One file part per binary file, named by its SHA-256: at most ${WORKSPACE_SOURCE_LIMITS.maxBlobsPerRequest} files and ${WORKSPACE_SOURCE_LIMITS.maxBlobBytesPerRequest} bytes per request, a larger file alone.`
  )

/** `POST /api/v2/workspaces/{workspaceId}/source/blobs`: stage binary files for an apply. */
export const v2StageWorkspaceSourceBlobsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workspaces/[workspaceId]/source/blobs',
  params: paramsSchema,
  query: noInputSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z
        .object({
          workspaceId: z.string().describe('Workspace id.'),
          staged: z.array(stagedBlobSchema).describe('The binary files now staged.'),
        })
        .describe('What the request staged.')
    ),
  },
})

const missingBodySchema = z
  .object({
    blobs: z
      .array(stagedBlobSchema)
      .max(
        WORKSPACE_SOURCE_LIMITS.maxStagedBlobs,
        `blobs cannot list more than ${WORKSPACE_SOURCE_LIMITS.maxStagedBlobs} files`
      )
      .describe('The binary files an apply will need.'),
  })
  .strict()

/**
 * `POST /api/v2/workspaces/{workspaceId}/source/blobs/missing`: which binary files the caller has
 * not staged.
 */
export const v2FindMissingWorkspaceSourceBlobsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workspaces/[workspaceId]/source/blobs/missing',
  params: paramsSchema,
  query: noInputSchema,
  body: missingBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z
        .object({
          workspaceId: z.string().describe('Workspace id.'),
          missing: z
            .array(sha256Schema)
            .describe('SHA-256 of each listed file that is not staged, in the order listed.'),
        })
        .describe('The binary files still to stage.')
    ),
  },
})
