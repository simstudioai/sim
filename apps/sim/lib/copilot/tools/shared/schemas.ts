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
  blocks: z.array(
    z
      .object({
        type: z.string(),
        name: z.string(),
        triggerAllowed: z.boolean().optional(),
        longDescription: z.string().optional(),
      })
      .passthrough()
  ),
})
export type GetBlocksAndToolsResultType = z.infer<typeof GetBlocksAndToolsResult>

// get_blocks_metadata
export const GetBlocksMetadataInput = z.object({ blockIds: z.array(z.string()).min(1) })
export const GetBlocksMetadataResult = z.object({ metadata: z.record(z.any()) })
export type GetBlocksMetadataResultType = z.infer<typeof GetBlocksMetadataResult>

// get_trigger_blocks
export const GetTriggerBlocksInput = z.object({})
export const GetTriggerBlocksResult = z.object({
  triggerBlockIds: z.array(z.string()),
})
export type GetTriggerBlocksResultType = z.infer<typeof GetTriggerBlocksResult>
