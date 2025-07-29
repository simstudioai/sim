import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createLogger } from '@/lib/logs/console-logger'
import { registry as blockRegistry } from '@/blocks/registry'
import { tools as toolsRegistry } from '@/tools/registry'
import { BaseCopilotTool } from '../base'

const logger = createLogger('GetBlockMetadataAPI')

interface GetBlocksMetadataParams {
  blockIds: string[]
}

interface BlocksMetadataResult {
  success: boolean
  data?: Record<string, any>
  error?: string
}

class GetBlocksMetadataTool extends BaseCopilotTool<GetBlocksMetadataParams, BlocksMetadataResult> {
  readonly id = 'get_blocks_metadata'
  readonly displayName = 'Getting block metadata'

  protected async executeImpl(params: GetBlocksMetadataParams): Promise<BlocksMetadataResult> {
    return getBlocksMetadata(params)
  }
}

// Export the tool instance
export const getBlocksMetadataTool = new GetBlocksMetadataTool()

// Implementation function
export async function getBlocksMetadata(params: GetBlocksMetadataParams): Promise<BlocksMetadataResult> {
  const { blockIds } = params

  if (!blockIds || !Array.isArray(blockIds)) {
    return {
      success: false,
      error: 'blockIds must be an array of block IDs',
    }
  }

  logger.info('Getting block metadata', {
    blockIds,
    blockCount: blockIds.length,
    requestedBlocks: blockIds.join(', '),
  })

  try {
    // Create result object
    const result: Record<string, any> = {}

    // Process each requested block ID
    for (const blockId of blockIds) {
      let metadata: any = {}
      
      // Check if it's a special block first
      if (SPECIAL_BLOCKS_METADATA[blockId]) {
        // Start with the special block metadata
        metadata = { ...SPECIAL_BLOCKS_METADATA[blockId] }
        // Normalize tools structure to match regular blocks
        metadata.tools = metadata.tools?.access || []
      } else {
        // Check if the block exists in the registry
        const blockConfig = blockRegistry[blockId]
        if (!blockConfig) {
          logger.warn(`Block not found in registry: ${blockId}`)
          continue
        }

        metadata = {
          id: blockId,
          name: blockConfig.name || blockId,
          description: blockConfig.description || '',
          inputs: blockConfig.inputs || {},
          outputs: blockConfig.outputs || {},
          tools: blockConfig.tools?.access || [],
        }
      }

      // Read YAML schema from documentation if available (for both regular and special blocks)
      const docFileName = DOCS_FILE_MAPPING[blockId] || blockId
      if (CORE_BLOCKS_WITH_DOCS.includes(blockId)) {
        try {
          // Updated path to point to the actual YAML documentation location
          const docPath = join(process.cwd(), 'apps', 'docs', 'content', 'docs', 'yaml', 'blocks', `${docFileName}.mdx`)
          if (existsSync(docPath)) {
            const docContent = readFileSync(docPath, 'utf-8')
            
            // Extract schema from the documentation
            const schemaMatch = docContent.match(/```yaml\s*\n([\s\S]*?)```/i)
            if (schemaMatch) {
              const yamlSchema = schemaMatch[1].trim()
              // Parse high-level structure only
              const lines = yamlSchema.split('\n')
              const schemaInfo: any = {
                fields: [],
                example: yamlSchema,
              }

              // Extract field names and structure
              lines.forEach(line => {
                const match = line.match(/^(\s*)(\w+):/)
                if (match) {
                  const indent = match[1].length
                  const fieldName = match[2]
                  if (indent === 0) {
                    schemaInfo.fields.push({
                      name: fieldName,
                      level: 'root',
                    })
                  }
                }
              })

              metadata.schema = schemaInfo
            }
          }
        } catch (error) {
          logger.warn(`Failed to read documentation for ${blockId}:`, error)
        }
      }

      // Add tool metadata if requested
      if (metadata.tools && metadata.tools.length > 0) {
        metadata.toolDetails = {}
        for (const toolId of metadata.tools) {
          const tool = toolsRegistry[toolId]
          if (tool) {
            metadata.toolDetails[toolId] = {
              name: tool.name,
              description: tool.description,
            }
          }
        }
      }

      result[blockId] = metadata
    }

    logger.info(`Successfully retrieved metadata for ${Object.keys(result).length} blocks`)

    return {
      success: true,
      data: result,
    }
  } catch (error) {
    logger.error('Get block metadata failed', error)
    return {
      success: false,
      error: `Failed to get block metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

// Core blocks that have documentation with YAML schemas
const CORE_BLOCKS_WITH_DOCS = [
  'agent',
  'function',
  'api',
  'condition',
  'loop',
  'parallel',
  'response',
  'router',
  'evaluator',
  'webhook',
]

// Mapping for blocks that have different doc file names
const DOCS_FILE_MAPPING: Record<string, string> = {
  // All core blocks use their registry ID as the doc filename
  // e.g., 'api' block -> 'api.mdx', 'agent' block -> 'agent.mdx'
}

// Special blocks that aren't in the standard registry but need metadata
const SPECIAL_BLOCKS_METADATA: Record<string, any> = {
  loop: {
    type: 'loop',
    name: 'Loop',
    description: 'Control flow block for iterating over collections or repeating actions',
    inputs: {
      loopType: { type: 'string', required: true, enum: ['for', 'forEach'] },
      iterations: { type: 'number', required: false, minimum: 1, maximum: 1000 },
      collection: { type: 'string', required: false },
      maxConcurrency: { type: 'number', required: false, default: 1, minimum: 1, maximum: 10 },
    },
    outputs: {
      results: 'array',
      currentIndex: 'number',
      currentItem: 'any',
      totalIterations: 'number',
    },
    tools: { access: [] },
  },
  parallel: {
    type: 'parallel',
    name: 'Parallel',
    description: 'Control flow block for executing multiple branches simultaneously',
    inputs: {
      parallelType: { type: 'string', required: true, enum: ['count', 'collection'] },
      count: { type: 'number', required: false, minimum: 1, maximum: 100 },
      collection: { type: 'string', required: false },
      maxConcurrency: { type: 'number', required: false, default: 10, minimum: 1, maximum: 50 },
    },
    outputs: {
      results: 'array',
      branchId: 'number',
      branchItem: 'any',
      totalBranches: 'number',
    },
    tools: { access: [] },
  },
}


