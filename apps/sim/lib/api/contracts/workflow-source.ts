import { isRecordLike } from '@sim/utils/object'
import type {
  DefinedField,
  SourceBase,
  WorkflowLockBlock,
  WorkflowLockV1,
} from '@sim/workflow-code'
import { DIAGNOSTIC_CODES } from '@sim/workflow-code/diagnostics/codes'
import { SOURCE_LIMITS } from '@sim/workflow-code/limits'
import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { workflowIdParamsSchema } from '@/lib/api/contracts/workflows'

/**
 * Workflow source: a stored draft printed as TypeScript against the workflow SDK, with its
 * identity lock. The shapes mirror `@sim/workflow-code`'s
 * `WorkflowLockV1` and `SourceBase`, which own them (each shape is checked against its type, see
 * {@link ShapeOf}); the internal route (the canvas Code tab) and the v2 route share these schemas.
 */

export const workflowSourceQuerySchema = z
  .object({
    functionCode: z
      .enum(['inline', 'files'], {
        error: 'functionCode: expected one of "inline" | "files"',
      })
      .optional()
      .describe(
        'Where function-block code goes: `files` (default) writes it to `functions/*` files referenced with `codeFile()`; `inline` prints it in tagged templates.'
      ),
  })
  .strict()

const EXTENSION_PREFIX = 'x-'

/**
 * A zod shape holding exactly the fields `@sim/workflow-code` defines on `T` (its `x-` extensions
 * aside), each producing the type `T` gives it: a field the package adds, drops or retypes is a
 * type error here, so the contract never drifts from the parser that owns the format.
 */
type ShapeOf<T> = { [K in DefinedField<T>]-?: z.ZodType<T[K]> }

/**
 * A lock object that tolerates and keeps `x-` extension fields (data a newer writer
 * emits waits under `x-` until validators know it) and still rejects any other unknown key.
 * Typed as the plain object so `@sim/workflow-code`'s lock interfaces, whose extension index is
 * `x-${string}`, stay assignable to it.
 */
function withExtensions<Shape extends z.ZodRawShape>(
  shape: Shape
): z.ZodType<z.output<z.ZodObject<Shape>>, z.input<z.ZodObject<Shape>>> {
  return z
    .object(shape)
    .catchall(z.unknown().describe('An `x-` extension field, kept verbatim.'))
    .superRefine((value, ctx) => {
      const unknown = Object.keys(value).filter(
        (key) => !Object.hasOwn(shape, key) && !key.startsWith(EXTENSION_PREFIX)
      )
      if (unknown.length > 0) {
        ctx.addIssue({
          code: 'unrecognized_keys',
          keys: unknown,
          message: `Unrecognized ${unknown.length === 1 ? 'key' : 'keys'}: ${unknown
            .map((key) => `"${key}"`)
            .join(', ')} (only \`${EXTENSION_PREFIX}\` extension fields are allowed)`,
        })
      }
    })
}

const lockLayoutSchema = withExtensions({
  x: z.number().describe('Canvas x position.'),
  y: z.number().describe('Canvas y position.'),
  w: z.number().optional().describe('Container width.'),
  h: z.number().optional().describe('Container height.'),
  height: z.number().optional().describe('Stored block height.'),
  horizontalHandles: z.boolean().optional().describe('Handles on the left and right.'),
} satisfies ShapeOf<NonNullable<WorkflowLockBlock['layout']>>).describe(
  'Stored canvas geometry; applied only to new blocks.'
)

/**
 * A string-keyed record of at most `max` entries, a workflow's cap (`parseWorkflowLock` agrees).
 * The entries are counted before any value is validated, so an oversized lock costs one key count
 * rather than a walk of every entry.
 */
function cappedRecord<Value extends z.ZodType>(values: Value, max: number, field: string) {
  return z.preprocess(
    (input, ctx) => {
      if (isRecordLike(input) && Object.keys(input).length > max) {
        ctx.addIssue({ code: 'custom', message: `${field} cannot hold more than ${max} entries` })
      }
      return input
    },
    z.record(z.string(), values)
  )
}

const lockBlockSchema = withExtensions({
  id: z.string().describe('Block id.'),
  parent: z.string().nullable().describe('Key of the enclosing loop or parallel, or null.'),
  branches: z
    .record(z.string(), z.string())
    .optional()
    .describe('Condition or router branch key → stored branch id.'),
  items: z
    .record(
      z.string(),
      z.array(
        z
          .object({
            name: z.string().describe('Item name.'),
            id: z.string().describe('Item id.'),
          })
          .strict()
          .describe('One id-bearing list item.')
      )
    )
    .optional()
    .describe('Per field, its id-bearing items (input format fields) in stored order.'),
  ident: z.string().describe('The `const` name the block is printed as.'),
  order: z.number().int().describe('Declaration-order tie-break.'),
  layout: lockLayoutSchema.optional(),
  codeFile: z.string().optional().describe('Path of the block’s function-code file.'),
} satisfies ShapeOf<WorkflowLockBlock>).describe('One block’s identity.')

export const workflowLockSchema = withExtensions({
  version: z.literal(1).describe('Lock format version.'),
  blocks: cappedRecord(lockBlockSchema, SOURCE_LIMITS.maxBlocks, 'lock.blocks').describe(
    'Block key → identity.'
  ),
  variables: cappedRecord(z.string(), SOURCE_LIMITS.maxVariables, 'lock.variables').describe(
    'Variable key → variable id.'
  ),
} satisfies ShapeOf<WorkflowLockV1>).describe(
  'Identity sidecar (`.sim/lock.json`): binds the keys in the source to stored ids.'
)

/** The `sf1:` fingerprint a source read or apply reports as `base.fingerprint`, by `field`. */
export function sourceFingerprintSchema(field: string) {
  return z
    .string()
    .regex(/^sf1:[0-9a-f]{64}$/, `${field} must be a source fingerprint (sf1: and 64 hex digits)`)
}

export const sourceBaseSchema = withExtensions({
  version: z
    .literal(1)
    .default(1)
    .describe('Base format version; a base written before it existed reads as 1.'),
  workflowId: z
    .string()
    .min(1, 'base.workflowId cannot be empty')
    .describe('Workflow the source was read from; an apply to another workflow is refused.'),
  workspaceId: z.string().describe('Workspace the workflow belongs to.'),
  fingerprint: z
    .string()
    .min(1, 'base.fingerprint cannot be empty')
    .max(256, 'base.fingerprint is too long')
    .describe(
      'Freshness token of the draft the source was read at: a hash of the canonical workflow and its ids. It ignores canvas positions, so moving blocks does not change it.'
    ),
  catalogHash: z.string().describe('Hash of the block catalog the source was printed against.'),
} satisfies ShapeOf<SourceBase>).describe(
  'Freshness facts for the lock in this environment (`.sim/base.json`).'
)

export const sourceReadDiagnosticSchema = z
  .object({
    code: z.enum(DIAGNOSTIC_CODES).describe('Diagnostic code, e.g. `W_CANON_UNRESOLVED_ID`.'),
    severity: z.enum(['error', 'warning', 'info']).describe('Diagnostic severity.'),
    message: z.string().describe('What was found.'),
    hint: z.string().optional().describe('How to address it.'),
    blockKey: z.string().optional().describe('Block the finding is about.'),
    param: z.string().optional().describe('Field the finding is about.'),
  })
  .describe('A finding from reading the stored graph as source.')

export const workflowSourceSchema = z
  .object({
    workflowId: z.string().describe('Workflow id.'),
    workspaceId: z.string().describe('Workspace id.'),
    files: z
      .record(z.string(), z.string())
      .describe('Relative path → file text: `workflow.ts`, then any `functions/*` files.'),
    lock: workflowLockSchema,
    base: sourceBaseSchema,
    canonicalHash: z
      .string()
      .describe('Hash of the canonical workflow alone, without ids; comments do not affect it.'),
    sdkMajor: z.number().int().describe('Workflow SDK major version of the source.'),
    blockTypes: z
      .array(z.string())
      .describe('Block types the source uses, as blocks or as agent tools, sorted.'),
    diagnostics: z
      .array(sourceReadDiagnosticSchema)
      .describe('Findings from reading the stored graph.'),
  })
  .describe('A workflow draft as TypeScript source.')

export type WorkflowSource = z.output<typeof workflowSourceSchema>

export const getWorkflowSourceContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/source',
  params: workflowIdParamsSchema,
  query: workflowSourceQuerySchema,
  response: { mode: 'json', schema: z.object({ data: workflowSourceSchema }) },
})
