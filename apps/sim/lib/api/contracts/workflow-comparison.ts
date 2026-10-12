import { z } from 'zod'
import { versionNumberPathSchema, versionNumberSchema } from '@/lib/api/contracts/primitives'

export const compareWorkflowVersionsQuerySchema = z
  .object({
    base: versionNumberPathSchema.describe('Deployment version to compare from.'),
    target: versionNumberPathSchema.describe(
      'Deployment version to compare to, in the same workflow.'
    ),
  })
  .strict()
  .meta({
    id: 'CompareWorkflowVersionsQuery',
    title: 'Workflow comparison parameters',
    description: 'Two numeric deployment versions belonging to the workflow in the path.',
  })
export type CompareWorkflowVersionsQuery = z.input<typeof compareWorkflowVersionsQuerySchema>

export const workflowComparisonValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unset').describe('The field has no configured value.') }),
  z.object({
    kind: z.literal('redacted').describe('The value is withheld by the credential policy.'),
  }),
  z.object({
    kind: z.literal('value').describe('The field value is included.'),
    // untyped-response: workflow field values are user-authored JSON with a shape defined by each subblock
    value: z.unknown().describe('The complete user-authored field value.'),
  }),
])
export type WorkflowComparisonValue = z.output<typeof workflowComparisonValueSchema>

const fieldChangeSchema = z.object({
  field: z.string().describe('Changed field identifier.'),
  oldValue: workflowComparisonValueSchema.describe('Base version value.'),
  newValue: workflowComparisonValueSchema.describe('Target version value.'),
})
const blockSchema = z.object({
  id: z.string().describe('Stable block identifier.'),
  type: z.string().describe('Block type.'),
  name: z.string().optional().describe('Block name.'),
})
const countsSchema = z.object({
  added: z.number().int().describe('Number added.'),
  removed: z.number().int().describe('Number removed.'),
  modified: z.number().int().describe('Number modified.'),
})
const edgeDetailSchema = z.object({
  source: z.string().describe('Stable source block identifier.'),
  target: z.string().describe('Stable target block identifier.'),
  sourceHandle: z
    .string()
    .optional()
    .describe('Source port identifier; omitted for the default port.'),
  targetHandle: z
    .string()
    .optional()
    .describe('Target port identifier; omitted for the default port.'),
  sourceName: z.string().describe('Source block name.'),
  targetName: z.string().describe('Target block name.'),
})

export const workflowComparisonSummarySchema = z.object({
  addedBlocks: z.array(blockSchema).describe('Blocks present only in the target.'),
  removedBlocks: z.array(blockSchema).describe('Blocks present only in the base.'),
  modifiedBlocks: z
    .array(
      blockSchema.extend({
        changes: z
          .array(
            fieldChangeSchema.extend({
              scope: z
                .enum(['block', 'subblock'])
                .describe('Whether the field is a block setting or a subblock input.'),
            })
          )
          .describe('Changed field values.'),
      })
    )
    .describe('Blocks with changed fields.'),
  edgeChanges: z
    .object({
      added: z.number().int().describe('Number added.'),
      removed: z.number().int().describe('Number removed.'),
      addedDetails: z.array(edgeDetailSchema).describe('Added connections.'),
      removedDetails: z.array(edgeDetailSchema).describe('Removed connections.'),
    })
    .describe('Connection changes.'),
  loopChanges: countsSchema.describe('Loop change counts.'),
  parallelChanges: countsSchema.describe('Parallel change counts.'),
  containerChanges: z
    .array(
      z.object({
        id: z.string().describe('Container block ID.'),
        kind: z.enum(['loop', 'parallel']).describe('Container type.'),
        name: z.string().optional().describe('Container name.'),
        changes: z.array(fieldChangeSchema).describe('Changed field values.'),
        nodesAdded: z.array(z.string()).describe('Added member block IDs.'),
        nodesRemoved: z.array(z.string()).describe('Removed member block IDs.'),
      })
    )
    .describe('Container configuration and membership changes.'),
  variableChanges: countsSchema
    .extend({
      addedNames: z.array(z.string()).describe('Names of added variables.'),
      removedNames: z.array(z.string()).describe('Names of removed variables.'),
      modifiedNames: z.array(z.string()).describe('Names of modified variables.'),
    })
    .describe('Variable change counts and names.'),
  hasChanges: z.boolean().describe('Whether any semantic change was found.'),
})
export type WorkflowComparisonSummary = z.output<typeof workflowComparisonSummarySchema>

export const compareWorkflowVersionsDataSchema = z
  .object({
    workflowId: z.string().describe('Workflow compared.'),
    base: versionNumberSchema.describe('Base deployment version.'),
    target: versionNumberSchema.describe('Target deployment version.'),
    diff: workflowComparisonSummarySchema.describe('Changes from base to target.'),
  })
  .meta({
    id: 'WorkflowVersionComparison',
    title: 'Workflow version comparison',
    description:
      'Semantic changes from base to target within one workflow. Credential-bearing fields are redacted; changes to them are still reported. Canvas layout is excluded.',
  })
export type CompareWorkflowVersionsData = z.output<typeof compareWorkflowVersionsDataSchema>
