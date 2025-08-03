import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createLogger } from '@/lib/logs/console/logger'
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
export async function getBlocksMetadata(
  params: GetBlocksMetadataParams
): Promise<BlocksMetadataResult> {
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

    logger.info('=== GET BLOCKS METADATA DEBUG ===')
    logger.info('Requested block IDs:', blockIds)

    // Process each requested block ID
    for (const blockId of blockIds) {
      logger.info(`\n--- Processing block: ${blockId} ---`)
      let metadata: any = {}

      // Check if it's a special block first
      if (SPECIAL_BLOCKS_METADATA[blockId]) {
        logger.info(`✓ Found ${blockId} in SPECIAL_BLOCKS_METADATA`)
        // Start with the special block metadata
        metadata = { ...SPECIAL_BLOCKS_METADATA[blockId] }
        // Normalize tools structure to match regular blocks
        metadata.tools = metadata.tools?.access || []
        logger.info(`Initial metadata keys for ${blockId}:`, Object.keys(metadata))
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
      logger.info(
        `Checking if ${blockId} is in CORE_BLOCKS_WITH_DOCS:`,
        CORE_BLOCKS_WITH_DOCS.includes(blockId)
      )

      if (CORE_BLOCKS_WITH_DOCS.includes(blockId)) {
        try {
          // Updated path to point to the actual YAML documentation location
          // Handle both monorepo root and apps/sim as working directory
          const workingDir = process.cwd()
          const isInAppsSim = workingDir.endsWith('/apps/sim') || workingDir.endsWith('\\apps\\sim')
          const basePath = isInAppsSim ? join(workingDir, '..', '..') : workingDir
          const docPath = join(
            basePath,
            'apps',
            'docs',
            'content',
            'docs',
            'yaml',
            'blocks',
            `${docFileName}.mdx`
          )
          logger.info(`Looking for docs at: ${docPath}`)
          logger.info(`File exists: ${existsSync(docPath)}`)

          if (existsSync(docPath)) {
            const docContent = readFileSync(docPath, 'utf-8')
            logger.info(`Doc content length: ${docContent.length}`)

            // Include the entire YAML documentation content
            metadata.yamlDocumentation = docContent
            logger.info(`✓ Added full YAML documentation for ${blockId}`)
          } else {
            logger.warn(`Documentation file not found for ${blockId}`)
          }
        } catch (error) {
          logger.warn(`Failed to read documentation for ${blockId}:`, error)
        }
      } else {
        logger.info(`${blockId} is NOT in CORE_BLOCKS_WITH_DOCS`)
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

      logger.info(`Final metadata keys for ${blockId}:`, Object.keys(metadata))
      logger.info(`Has YAML documentation: ${!!metadata.yamlDocumentation}`)

      result[blockId] = metadata
    }

    logger.info('\n=== FINAL RESULT ===')
    logger.info(`Successfully retrieved metadata for ${Object.keys(result).length} blocks`)
    logger.info('Result keys:', Object.keys(result))

    // Log the full result for parallel block if it's included
    if (result.parallel) {
      logger.info('\nParallel block metadata keys:', Object.keys(result.parallel))
      if (result.parallel.yamlDocumentation) {
        logger.info('YAML documentation length:', result.parallel.yamlDocumentation.length)
      }
    }

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
