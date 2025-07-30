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

    // Process each requested block ID
    for (const blockId of blockIds) {
      // Check if it's a special block first
      if (SPECIAL_BLOCKS_METADATA[blockId]) {
        result[blockId] = SPECIAL_BLOCKS_METADATA[blockId]
        continue
      }

      // Check if the block exists in the registry
      const blockConfig = blockRegistry[blockId]
      if (!blockConfig) {
        logger.warn(`Block not found in registry: ${blockId}`)
        continue
      }

      const metadata: any = {
        id: blockId,
        name: blockConfig.name || blockId,
        description: blockConfig.description || '',
        category: blockConfig.category || 'general',
        inputs: blockConfig.inputs || {},
        outputs: blockConfig.outputs || {},
        tools: blockConfig.tools?.access || [],
      }

      // Read YAML schema from documentation if available
      const docFileName = DOCS_FILE_MAPPING[blockId] || blockId
      if (CORE_BLOCKS_WITH_DOCS.includes(blockId)) {
        try {
          const docPath = join(process.cwd(), 'content', 'docs', 'blocks', `${docFileName}.mdx`)
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
              lines.forEach((line) => {
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
      if (metadata.tools.length > 0) {
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
  webhook: 'webhook_trigger',
}

// Special blocks that aren't in the standard registry but need metadata
const SPECIAL_BLOCKS_METADATA: Record<string, any> = {
  loop: {
    type: 'loop',
    name: 'Loop',
    description: 'Control flow block for iterating over collections or repeating actions',
    longDescription:
      'Execute a set of blocks repeatedly, either for a fixed number of iterations or for each item in a collection. Loop blocks create sub-workflows that run multiple times with different iteration data.',
    category: 'blocks',
    bgColor: '#9333EA',
    subBlocks: [
      {
        id: 'iterationType',
        title: 'Iteration Type',
        type: 'dropdown',
        layout: 'full',
        options: [
          { label: 'Fixed Count', id: 'fixed' },
          { label: 'For Each Item', id: 'forEach' },
        ],
        description: 'Choose how the loop should iterate',
      },
      {
        id: 'iterationCount',
        title: 'Iteration Count',
        type: 'short-input',
        layout: 'half',
        placeholder: '5',
        condition: { field: 'iterationType', value: 'fixed' },
        description: 'Number of times to repeat the loop',
      },
      {
        id: 'collection',
        title: 'Collection',
        type: 'short-input',
        layout: 'full',
        placeholder: 'Reference to array or object',
        condition: { field: 'iterationType', value: 'forEach' },
        description: 'Array or object to iterate over',
      },
    ],
    inputs: {
      iterationType: { type: 'string', required: true },
      iterationCount: { type: 'number', required: false },
      collection: { type: 'array|object', required: false },
    },
    outputs: {
      results: 'array',
      iterations: 'number',
    },
    tools: { access: [] },
  },
  parallel: {
    type: 'parallel',
    name: 'Parallel',
    description: 'Control flow block for executing multiple branches simultaneously',
    longDescription:
      'Execute multiple sets of blocks simultaneously, either with a fixed number of parallel branches or by distributing items from a collection across parallel executions.',
    category: 'blocks',
    bgColor: '#059669',
    subBlocks: [
      {
        id: 'parallelType',
        title: 'Parallel Type',
        type: 'dropdown',
        layout: 'full',
        options: [
          { label: 'Fixed Count', id: 'count' },
          { label: 'Collection Distribution', id: 'collection' },
        ],
        description: 'Choose how parallel execution should work',
      },
      {
        id: 'parallelCount',
        title: 'Parallel Count',
        type: 'short-input',
        layout: 'half',
        placeholder: '3',
        condition: { field: 'parallelType', value: 'count' },
        description: 'Number of parallel branches to execute',
      },
      {
        id: 'collection',
        title: 'Collection',
        type: 'short-input',
        layout: 'full',
        placeholder: 'Reference to array to distribute',
        condition: { field: 'parallelType', value: 'collection' },
        description: 'Array to distribute across parallel executions',
      },
    ],
    inputs: {
      parallelType: { type: 'string', required: true },
      parallelCount: { type: 'number', required: false },
      collection: { type: 'array', required: false },
    },
    outputs: {
      results: 'array',
      branches: 'number',
    },
    tools: { access: [] },
  },
}

// Helper function to read YAML schema from dedicated YAML documentation files
function getYamlSchemaFromDocs(blockType: string): string | null {
  try {
    const docFileName = DOCS_FILE_MAPPING[blockType] || blockType
    // Read from the new YAML documentation structure
    const yamlDocsPath = join(
      process.cwd(),
      '..',
      'docs/content/docs/yaml/blocks',
      `${docFileName}.mdx`
    )

    if (!existsSync(yamlDocsPath)) {
      logger.warn(`YAML schema file not found for ${blockType} at ${yamlDocsPath}`)
      return null
    }

    const content = readFileSync(yamlDocsPath, 'utf-8')

    // Remove the frontmatter and return the content after the title
    const contentWithoutFrontmatter = content.replace(/^---[\s\S]*?---\s*/, '')
    return contentWithoutFrontmatter.trim()
  } catch (error) {
    logger.warn(`Failed to read YAML schema for ${blockType}:`, error)
    return null
  }
}
