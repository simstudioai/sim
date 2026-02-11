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

// get_block_options
export const GetBlockOptionsInput = z.object({
  blockId: z.string(),
})
export const GetBlockOptionsResult = z.object({
  blockId: z.string(),
  blockName: z.string(),
  operations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
    })
  ),
})
export type GetBlockOptionsInputType = z.infer<typeof GetBlockOptionsInput>
export type GetBlockOptionsResultType = z.infer<typeof GetBlockOptionsResult>

// get_block_config
export const GetBlockConfigInput = z.object({
  blockType: z.string(),
  operation: z.string().optional(),
  trigger: z.boolean().optional(),
})
export const GetBlockConfigResult = z.object({
  blockType: z.string(),
  blockName: z.string(),
  operation: z.string().optional(),
  trigger: z.boolean().optional(),
  inputs: z.record(z.any()),
  outputs: z.record(z.any()),
})
export type GetBlockConfigInputType = z.infer<typeof GetBlockConfigInput>
export type GetBlockConfigResultType = z.infer<typeof GetBlockConfigResult>

// knowledge_base - shared schema used by client tool, server tool, and registry
export const KnowledgeBaseArgsSchema = z.object({
  operation: z.enum(['create', 'list', 'get', 'query']),
  args: z
    .object({
      /** Name of the knowledge base (required for create) */
      name: z.string().optional(),
      /** Description of the knowledge base (optional for create) */
      description: z.string().optional(),
      /** Workspace ID to associate with (required for create, optional for list) */
      workspaceId: z.string().optional(),
      /** Knowledge base ID (required for get, query) */
      knowledgeBaseId: z.string().optional(),
      /** Search query text (required for query) */
      query: z.string().optional(),
      /** Number of results to return (optional for query, defaults to 5) */
      topK: z.number().min(1).max(50).optional(),
      /** Chunking configuration (optional for create) */
      chunkingConfig: z
        .object({
          maxSize: z.number().min(100).max(4000).default(1024),
          minSize: z.number().min(1).max(2000).default(1),
          overlap: z.number().min(0).max(500).default(200),
        })
        .optional(),
    })
    .optional(),
})
export type KnowledgeBaseArgs = z.infer<typeof KnowledgeBaseArgsSchema>

export const KnowledgeBaseResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.any().optional(),
})
export type KnowledgeBaseResult = z.infer<typeof KnowledgeBaseResultSchema>

export const GetBlockOutputsInput = z.object({
  blockIds: z.array(z.string()).optional(),
})
export const GetBlockOutputsResult = z.object({
  blocks: z.array(
    z.object({
      blockId: z.string(),
      blockName: z.string(),
      blockType: z.string(),
      triggerMode: z.boolean().optional(),
      outputs: z.array(z.string()),
      insideSubflowOutputs: z.array(z.string()).optional(),
      outsideSubflowOutputs: z.array(z.string()).optional(),
    })
  ),
  variables: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        tag: z.string(),
      })
    )
    .optional(),
})
export type GetBlockOutputsInputType = z.infer<typeof GetBlockOutputsInput>
export type GetBlockOutputsResultType = z.infer<typeof GetBlockOutputsResult>

export const GetBlockUpstreamReferencesInput = z.object({
  blockIds: z.array(z.string()).min(1),
})
export const GetBlockUpstreamReferencesResult = z.object({
  results: z.array(
    z.object({
      blockId: z.string(),
      blockName: z.string(),
      insideSubflows: z
        .array(
          z.object({
            blockId: z.string(),
            blockName: z.string(),
            blockType: z.string(),
          })
        )
        .optional(),
      accessibleBlocks: z.array(
        z.object({
          blockId: z.string(),
          blockName: z.string(),
          blockType: z.string(),
          triggerMode: z.boolean().optional(),
          outputs: z.array(z.string()),
          accessContext: z.enum(['inside', 'outside']).optional(),
        })
      ),
      variables: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          type: z.string(),
          tag: z.string(),
        })
      ),
    })
  ),
})
export type GetBlockUpstreamReferencesInputType = z.infer<typeof GetBlockUpstreamReferencesInput>
export type GetBlockUpstreamReferencesResultType = z.infer<typeof GetBlockUpstreamReferencesResult>
