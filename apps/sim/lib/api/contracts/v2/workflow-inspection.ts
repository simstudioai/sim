import { z } from 'zod'
import { booleanQueryFlagSchema, MAX_ID_LENGTH } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'
import { v2WorkflowIdParamsSchema } from '@/lib/api/contracts/v2/workflows'

export const v2InspectWorkflowQuerySchema = z
  .object({
    blockId: z
      .string()
      .min(1, 'blockId cannot be empty')
      .max(MAX_ID_LENGTH)
      .optional()
      .describe('Inspect one block and its incident connections. Omit to inspect the draft graph.'),
    includeCode: booleanQueryFlagSchema
      .default(false)
      .describe(
        'Include bounded code inputs. Code and free text can contain hardcoded secrets that automatic redaction cannot recognize.'
      ),
  })
  .strict()

export type V2InspectWorkflowQuery = z.output<typeof v2InspectWorkflowQuerySchema>

export const v2WorkflowInspectionSchema = z
  .object({
    representation: z
      .literal('diagnostic')
      .describe('A read-only diagnostic projection, unsuitable for replacing workflow state.'),
    workflowId: z.string().describe('Workflow whose saved draft is inspected.'),
    workspaceId: z.string().describe('Workspace containing the workflow.'),
    blocks: z
      .array(
        z.object({
          id: z.string().describe('Canonical saved block ID.'),
          name: z.string().describe('Block display name.'),
          type: z.string().describe('Registered block type.'),
          enabled: z.boolean().describe('Whether the block is enabled in the saved draft.'),
          parentId: z
            .string()
            .nullable()
            .describe('Containing loop or parallel block ID, or null for a top-level block.'),
          /** Author-defined input values retain their JSON shape after bounded redaction. */
          inputs: z
            .record(
              z.string(),
              z
                .unknown()
                .describe(
                  'User-authored block configuration after redaction and diagnostic size limits.'
                )
                .meta({ examples: ['send'] })
            )
            .describe('Bounded, redacted user-authored input values. Empty fields are omitted.'),
          omittedInputs: z
            .array(z.string())
            .describe(
              'Nonempty fields withheld by credential, unknown-field, visibility, or code-inclusion rules.'
            ),
        })
      )
      .describe('Selected blocks without positions, output schemas, or runtime state.'),
    edges: z
      .array(
        z.object({
          source: z.string().describe('Source block ID.'),
          target: z.string().describe('Target block ID.'),
          sourceHandle: z
            .string()
            .nullable()
            .describe('Source output handle, or null when unspecified.'),
          targetHandle: z
            .string()
            .nullable()
            .describe('Target input handle, or null when unspecified.'),
        })
      )
      .describe('Draft connections, or only connections touching the selected block.'),
    truncated: z
      .boolean()
      .describe('Whether an input exceeded the diagnostic size or depth budget.'),
    notes: z.array(z.string()).describe('Representation, redaction, and size-limit guidance.'),
  })
  .meta({
    id: 'WorkflowInspection',
    title: 'Workflow inspection',
    description:
      'Compact diagnostic workflow draft, with credential fields withheld and projected inputs bounded.',
  })

export type V2WorkflowInspection = z.output<typeof v2WorkflowInspectionSchema>

export const v2InspectWorkflowContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[workflowId]/inspect',
  params: v2WorkflowIdParamsSchema,
  query: v2InspectWorkflowQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2WorkflowInspectionSchema) },
})
