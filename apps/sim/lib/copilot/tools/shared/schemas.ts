import { z } from 'zod'

// Generic envelope used by client to validate API responses
export const ExecuteResponseSuccessSchema = z.object({
  success: z.literal(true),
  result: z.unknown(),
})
export type ExecuteResponseSuccess = z.infer<typeof ExecuteResponseSuccessSchema>

// get_blocks_and_tools
export const GetBlocksAndToolsInput = z.object({})
export const GetBlocksAndToolsResult = z.object({
  blocks: z.array(z.object({ id: z.string(), type: z.string(), name: z.string() }).passthrough()),
  tools: z.array(z.object({ id: z.string(), type: z.string(), name: z.string() }).passthrough()),
})
export type GetBlocksAndToolsResultType = z.infer<typeof GetBlocksAndToolsResult>

// get_blocks_metadata
export const GetBlocksMetadataInput = z.object({ blockIds: z.array(z.string()).min(1) })
export const GetBlocksMetadataResult = z.object({ metadata: z.record(z.any()) })
export type GetBlocksMetadataResultType = z.infer<typeof GetBlocksMetadataResult>

// build_workflow
export const BuildWorkflowInput = z.object({
  yamlContent: z.string(),
  description: z.string().optional(),
})
export const BuildWorkflowResult = z.object({
  success: z.boolean(),
  message: z.string(),
  yamlContent: z.string(),
  description: z.string().optional(),
  workflowState: z.unknown().optional(),
  data: z
    .object({
      blocksCount: z.number(),
      edgesCount: z.number(),
    })
    .optional(),
})
export type BuildWorkflowResultType = z.infer<typeof BuildWorkflowResult>
