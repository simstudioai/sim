import { z } from 'zod'
import { booleanQueryFlagSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { workflowIdParamsSchema } from '@/lib/api/contracts/workflows'

/**
 * Workflow source: a stored draft printed as TypeScript against the workflow SDK, with its
 * identity lock (build-spec decisions 11–13). The shapes mirror `@sim/workflow-code`'s
 * `WorkflowLockV1` and `LockBase`, which own them; the internal route (the canvas Code tab) and
 * the v2 route share these schemas.
 */

export const workflowSourceQuerySchema = z
  .object({
    annotateIds: booleanQueryFlagSchema
      .optional()
      .describe("Print each block's id as a trailing `// id:` comment on its declaration."),
    functionCode: z
      .enum(['inline', 'files'], {
        error: 'functionCode: expected one of "inline" | "files"',
      })
      .optional()
      .describe(
        'Where function-block code goes: `files` (default) writes it to `functions/*` files referenced with `file()`; `inline` prints it in tagged templates.'
      ),
  })
  .strict()

const lockLayoutSchema = z
  .object({
    x: z.number().describe('Canvas x position.'),
    y: z.number().describe('Canvas y position.'),
    w: z.number().optional().describe('Container width.'),
    h: z.number().optional().describe('Container height.'),
    height: z.number().optional().describe('Stored block height.'),
    horizontalHandles: z.boolean().optional().describe('Handles on the left and right.'),
  })
  .strict()
  .describe('Stored canvas geometry; applied only to new blocks.')

const lockBlockSchema = z
  .object({
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
    binding: z.string().describe('The `const` name the block is printed as.'),
    order: z.number().int().describe('Declaration-order tie-break.'),
    layout: lockLayoutSchema.optional(),
    codeFile: z.string().optional().describe('Path of the block’s function-code file.'),
  })
  .strict()
  .describe('One block’s identity.')

export const workflowLockSchema = z
  .object({
    lockVersion: z.literal(1).describe('Lock format version.'),
    blocks: z.record(z.string(), lockBlockSchema).describe('Block key → identity.'),
    variables: z.record(z.string(), z.string()).describe('Variable key → variable id.'),
  })
  .strict()
  .describe('Identity sidecar (`.sim/lock.json`): binds the keys in the source to stored ids.')

export const lockBaseSchema = z
  .object({
    workspaceId: z.string().describe('Workspace the workflow belongs to.'),
    baseFingerprint: z.string().describe('The `fingerprint` this source was read at.'),
    catalogHash: z.string().describe('Hash of the block catalog the source was printed against.'),
  })
  .strict()
  .describe('Freshness facts for the lock in this environment (`.sim/base.json`).')

const sourceWarningSchema = z
  .object({
    code: z.string().describe('Diagnostic code, e.g. `W_CANON_UNRESOLVED_ID`.'),
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
    lockBase: lockBaseSchema,
    fingerprint: z
      .string()
      .describe(
        'Freshness token of the stored draft. It ignores canvas positions, so moving blocks does not change it.'
      ),
    canonicalHash: z
      .string()
      .describe('Hash of the canonical workflow the files compile to; comments do not affect it.'),
    catalogVersion: z
      .string()
      .describe('Hash of the block catalog the source was printed against.'),
    sdkMajor: z.number().int().describe('Workflow SDK major version of the source.'),
    warnings: z.array(sourceWarningSchema).describe('Findings from reading the stored graph.'),
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
