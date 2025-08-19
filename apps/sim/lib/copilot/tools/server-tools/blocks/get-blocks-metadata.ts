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
    logger.info('=== GetBlocksMetadataTool.executeImpl START ===', {
      params: JSON.stringify(params),
      hasParams: !!params,
      paramsKeys: params ? Object.keys(params) : [],
      timestamp: new Date().toISOString(),
    })
    
    const result = await getBlocksMetadata(params)
    
    logger.info('=== GetBlocksMetadataTool.executeImpl COMPLETE ===', {
      success: result.success,
      hasData: !!result.data,
      dataKeys: result.data ? Object.keys(result.data) : [],
      error: result.error,
      timestamp: new Date().toISOString(),
    })
    
    return result
  }
}

// Export the tool instance
export const getBlocksMetadataTool = new GetBlocksMetadataTool()

/**
 * Safely resolve subblock options, handling both static arrays and functions
 */
function resolveSubBlockOptions(options: any): any[] {
  logger.info('resolveSubBlockOptions called', {
    optionsType: typeof options,
    isFunction: typeof options === 'function',
    isArray: Array.isArray(options),
  })
  
  try {
    if (typeof options === 'function') {
      logger.info('Options is a function, attempting to resolve')
      const resolved = options()
      logger.info('Function resolved', {
        resultType: typeof resolved,
        isArray: Array.isArray(resolved),
        count: Array.isArray(resolved) ? resolved.length : 0,
      })
      return Array.isArray(resolved) ? resolved : []
    }
    
    if (Array.isArray(options)) {
      logger.info('Options is an array', {
        count: options.length,
        sample: options.slice(0, 3),
      })
    }
    
    return Array.isArray(options) ? options : []
  } catch (error) {
    logger.warn('Failed to resolve subblock options:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      optionsType: typeof options,
    })
    return []
  }
}

/**
 * Process subBlocks configuration to include all UI metadata
 */
function processSubBlocks(subBlocks: any[]): any[] {
  logger.info('processSubBlocks called', {
    isArray: Array.isArray(subBlocks),
    count: Array.isArray(subBlocks) ? subBlocks.length : 0,
  })
  
  if (!Array.isArray(subBlocks)) {
    logger.warn('subBlocks is not an array', {
      type: typeof subBlocks,
    })
    return []
  }

  logger.info('Processing subBlocks array', {
    totalCount: subBlocks.length,
    subBlockIds: subBlocks.map(sb => sb.id),
  })

  return subBlocks.map((subBlock, index) => {
    logger.info(`Processing subBlock at index ${index}`, {
      id: subBlock.id,
      type: subBlock.type,
      title: subBlock.title,
      hasOptions: !!subBlock.options,
      optionsType: subBlock.options ? typeof subBlock.options : undefined,
      hasCondition: !!subBlock.condition,
      required: subBlock.required,
    })
    
    const processedSubBlock: any = {
      id: subBlock.id,
      title: subBlock.title,
      type: subBlock.type,
      layout: subBlock.layout,
      mode: subBlock.mode,
      required: subBlock.required,
      placeholder: subBlock.placeholder,
      description: subBlock.description,
      hidden: subBlock.hidden,
      condition: subBlock.condition,
      // Slider specific
      min: subBlock.min,
      max: subBlock.max,
      step: subBlock.step,
      integer: subBlock.integer,
      // Input specific
      rows: subBlock.rows,
      password: subBlock.password,
      multiSelect: subBlock.multiSelect,
      // Code specific
      language: subBlock.language,
      generationType: subBlock.generationType,
      // OAuth specific
      provider: subBlock.provider,
      serviceId: subBlock.serviceId,
      requiredScopes: subBlock.requiredScopes,
      // File specific
      mimeType: subBlock.mimeType,
      acceptedTypes: subBlock.acceptedTypes,
      multiple: subBlock.multiple,
      maxSize: subBlock.maxSize,
      // Other properties
      connectionDroppable: subBlock.connectionDroppable,
      columns: subBlock.columns,
      value: typeof subBlock.value === 'function' ? 'function' : undefined, // Don't serialize functions
      wandConfig: subBlock.wandConfig,
    }

    // Resolve options if present
    if (subBlock.options) {
      logger.info(`Resolving options for subBlock ${subBlock.id}`)
      try {
        const resolvedOptions = resolveSubBlockOptions(subBlock.options)
        logger.info(`Options resolved for subBlock ${subBlock.id}`, {
          count: resolvedOptions.length,
          hasOptions: resolvedOptions.length > 0,
        })
        
        processedSubBlock.options = resolvedOptions.map((option) => {
          const processedOption = {
            label: option.label,
            id: option.id,
            // Note: Icons are React components, so we'll just indicate if they exist
            hasIcon: !!option.icon,
          }
          logger.info(`Processed option for subBlock ${subBlock.id}`, {
            optionId: option.id,
            label: option.label,
            hasIcon: !!option.icon,
          })
          return processedOption
        })
      } catch (error) {
        logger.warn(`Failed to resolve options for subBlock ${subBlock.id}:`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        processedSubBlock.options = []
      }
    }

    // Count defined properties before filtering
    const definedPropsCount = Object.entries(processedSubBlock).filter(([_, value]) => value !== undefined).length
    logger.info(`SubBlock ${subBlock.id} processed`, {
      totalProps: Object.keys(processedSubBlock).length,
      definedProps: definedPropsCount,
      hasOptions: !!processedSubBlock.options,
      optionsCount: processedSubBlock.options ? processedSubBlock.options.length : 0,
    })

    // Remove undefined properties to keep the response clean
    return Object.fromEntries(
      Object.entries(processedSubBlock).filter(([_, value]) => value !== undefined)
    )
  })
}

// Implementation function
export async function getBlocksMetadata(
  params: GetBlocksMetadataParams
): Promise<BlocksMetadataResult> {
  logger.info('=== getBlocksMetadata FUNCTION START ===', {
    receivedParams: JSON.stringify(params),
    paramsType: typeof params,
    timestamp: new Date().toISOString(),
  })

  const { blockIds } = params

  // Validation logs
  try {
    logger.info('VALIDATION: get_blocks_metadata received params', {
      hasParams: params !== undefined && params !== null,
      paramsType: typeof params,
      paramsKeys: params ? Object.keys(params) : [],
      hasBlockIds: blockIds !== undefined,
      blockIdsType: blockIds === undefined ? 'undefined' : Array.isArray(blockIds) ? 'array' : typeof blockIds,
      isArray: Array.isArray(blockIds),
      blockIdsCount: Array.isArray(blockIds) ? blockIds.length : null,
      blockIdsPreview: Array.isArray(blockIds) ? blockIds.slice(0, 10) : undefined,
      rawBlockIds: blockIds,
    })
  } catch (err) {
    logger.error('VALIDATION: Error during parameter validation logging', {
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }

  if (!blockIds || !Array.isArray(blockIds)) {
    logger.error('VALIDATION FAILED: blockIds is not an array', {
      blockIds,
      blockIdsType: typeof blockIds,
      isArray: Array.isArray(blockIds),
      isNull: blockIds === null,
      isUndefined: blockIds === undefined,
    })
    return {
      success: false,
      error: 'blockIds must be an array of block IDs',
    }
  }

  logger.info('Getting block metadata - VALIDATION PASSED', {
    blockIds,
    blockCount: blockIds.length,
    requestedBlocks: blockIds.join(', '),
  })

  try {
    // Create result object
    const result: Record<string, any> = {}

    logger.info('=== GET BLOCKS METADATA DEBUG ===')
    logger.info('Requested block IDs:', blockIds)
    logger.info('Starting to process blocks', {
      totalBlocks: blockIds.length,
      blockRegistry: !!blockRegistry,
      specialBlocksMetadata: !!SPECIAL_BLOCKS_METADATA,
    })

    // Process each requested block ID
    for (const blockId of blockIds) {
      logger.info(`\n--- Processing block: ${blockId} ---`)
      logger.info(`Processing block iteration`, {
        currentBlock: blockId,
        index: blockIds.indexOf(blockId),
        total: blockIds.length,
      })
      
      let metadata: any = {}

      // Check if it's a special block first
      const isSpecialBlock = !!SPECIAL_BLOCKS_METADATA[blockId]
      logger.info(`Checking if ${blockId} is a special block`, {
        isSpecialBlock,
        specialBlocksKeys: Object.keys(SPECIAL_BLOCKS_METADATA),
      })
      
      if (SPECIAL_BLOCKS_METADATA[blockId]) {
        logger.info(`✓ Found ${blockId} in SPECIAL_BLOCKS_METADATA`)
        // Start with the special block metadata
        metadata = { ...SPECIAL_BLOCKS_METADATA[blockId] }
        // Normalize tools structure to match regular blocks
        metadata.tools = metadata.tools?.access || []
        logger.info(`Initial metadata keys for ${blockId}:`, Object.keys(metadata))
        logger.info(`Special block metadata loaded`, {
          blockId,
          metadataKeys: Object.keys(metadata),
          hasSubBlocks: !!metadata.subBlocks,
          subBlocksCount: metadata.subBlocks ? metadata.subBlocks.length : 0,
          tools: metadata.tools,
        })
      } else {
        // Check if the block exists in the registry
        logger.info(`Checking block registry for ${blockId}`, {
          registryKeys: Object.keys(blockRegistry).slice(0, 10),
          hasBlock: !!blockRegistry[blockId],
        })
        
        const blockConfig = blockRegistry[blockId]
        if (!blockConfig) {
          logger.warn(`Block not found in registry: ${blockId}`, {
            availableBlocks: Object.keys(blockRegistry).slice(0, 20),
          })
          continue
        }

        logger.info(`Found ${blockId} in block registry`, {
          hasName: !!blockConfig.name,
          hasDescription: !!blockConfig.description,
          hasSubBlocks: !!blockConfig.subBlocks,
          subBlocksCount: blockConfig.subBlocks ? blockConfig.subBlocks.length : 0,
          hasInputs: !!blockConfig.inputs,
          hasOutputs: !!blockConfig.outputs,
          hasTools: !!blockConfig.tools,
          category: blockConfig.category,
        })

        metadata = {
          id: blockId,
          name: blockConfig.name || blockId,
          description: blockConfig.description || '',
          longDescription: blockConfig.longDescription,
          category: blockConfig.category,
          bgColor: blockConfig.bgColor,
          inputs: blockConfig.inputs || {},
          outputs: blockConfig.outputs || {},
          tools: blockConfig.tools?.access || [],
          hideFromToolbar: blockConfig.hideFromToolbar,
        }

        // Process and include subBlocks configuration
        if (blockConfig.subBlocks && Array.isArray(blockConfig.subBlocks)) {
          logger.info(`Processing ${blockConfig.subBlocks.length} subBlocks for ${blockId}`)
          
          try {
            metadata.subBlocks = processSubBlocks(blockConfig.subBlocks)
            logger.info(`✓ Processed subBlocks for ${blockId}:`, {
              count: metadata.subBlocks.length,
              subBlockIds: metadata.subBlocks.map((sb: any) => sb.id),
            })
          } catch (err) {
            logger.error(`Failed to process subBlocks for ${blockId}`, {
              error: err instanceof Error ? err.message : 'Unknown error',
            })
            metadata.subBlocks = []
          }
        } else {
          logger.info(`No subBlocks found for ${blockId}`)
          metadata.subBlocks = []
        }
      }

      // Read YAML schema from documentation if available (for both regular and special blocks)
      const docFileName = DOCS_FILE_MAPPING[blockId] || blockId
      logger.info(`Checking documentation for ${blockId}`, {
        docFileName,
        isInCoreBlocks: CORE_BLOCKS_WITH_DOCS.includes(blockId),
        coreBlocksList: CORE_BLOCKS_WITH_DOCS,
      })

      if (CORE_BLOCKS_WITH_DOCS.includes(blockId)) {
        try {
          // Updated path to point to the actual YAML documentation location
          // Handle both monorepo root and apps/sim as working directory
          const workingDir = process.cwd()
          logger.info(`Current working directory: ${workingDir}`)
          
          const isInAppsSim = workingDir.endsWith('/apps/sim') || workingDir.endsWith('\\apps\\sim')
          logger.info(`Is in apps/sim: ${isInAppsSim}`)
          
          const basePath = isInAppsSim ? join(workingDir, '..', '..') : workingDir
          logger.info(`Base path for docs: ${basePath}`)
          
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
          
          const fileExists = existsSync(docPath)
          logger.info(`File exists: ${fileExists}`)

          if (fileExists) {
            const docContent = readFileSync(docPath, 'utf-8')
            logger.info(`Doc content length: ${docContent.length}`)
            logger.info(`Doc content preview: ${docContent.substring(0, 200)}...`)

            // Include the entire YAML documentation content
            metadata.yamlDocumentation = docContent
            logger.info(`✓ Added full YAML documentation for ${blockId}`, {
              docLength: docContent.length,
              hasYamlBlock: docContent.includes('```yaml'),
            })
          } else {
            logger.warn(`Documentation file not found for ${blockId}`, {
              attemptedPath: docPath,
            })
          }
        } catch (error) {
          logger.warn(`Failed to read documentation for ${blockId}:`, {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
          })
        }
      } else {
        logger.info(`${blockId} is NOT in CORE_BLOCKS_WITH_DOCS, skipping documentation`)
      }

      // Add tool metadata if requested
      if (metadata.tools && metadata.tools.length > 0) {
        logger.info(`Processing tool details for ${blockId}`, {
          toolCount: metadata.tools.length,
          toolIds: metadata.tools,
        })
        
        metadata.toolDetails = {}
        for (const toolId of metadata.tools) {
          const tool = toolsRegistry[toolId]
          if (tool) {
            metadata.toolDetails[toolId] = {
              name: tool.name,
              description: tool.description,
            }
            logger.info(`Added tool detail for ${toolId}`, {
              name: tool.name,
            })
          } else {
            logger.warn(`Tool not found in registry: ${toolId}`)
          }
        }
      }

      logger.info(`Final metadata keys for ${blockId}:`, Object.keys(metadata))
      logger.info(`Has YAML documentation: ${!!metadata.yamlDocumentation}`)
      logger.info(`Has subBlocks: ${!!metadata.subBlocks && metadata.subBlocks.length > 0}`)
      logger.info(`Block ${blockId} processing complete`, {
        metadataKeys: Object.keys(metadata),
        hasYamlDoc: !!metadata.yamlDocumentation,
        yamlDocLength: metadata.yamlDocumentation ? metadata.yamlDocumentation.length : 0,
        subBlocksCount: metadata.subBlocks ? metadata.subBlocks.length : 0,
        toolsCount: metadata.tools ? metadata.tools.length : 0,
        toolDetailsCount: metadata.toolDetails ? Object.keys(metadata.toolDetails).length : 0,
      })

      result[blockId] = metadata
    }

    logger.info('\n=== FINAL RESULT ===')
    logger.info(`Successfully retrieved metadata for ${Object.keys(result).length} blocks`)
    logger.info('Result keys:', Object.keys(result))
    logger.info('Detailed result summary:', {
      totalBlocks: Object.keys(result).length,
      blockIds: Object.keys(result),
      blocksWithYaml: Object.keys(result).filter(id => result[id].yamlDocumentation).length,
      blocksWithSubBlocks: Object.keys(result).filter(id => result[id].subBlocks && result[id].subBlocks.length > 0).length,
      blocksWithTools: Object.keys(result).filter(id => result[id].tools && result[id].tools.length > 0).length,
    })

    // Log the full result for parallel block if it's included
    if (result.parallel) {
      logger.info('\nParallel block metadata keys:', Object.keys(result.parallel))
      if (result.parallel.yamlDocumentation) {
        logger.info('YAML documentation length:', result.parallel.yamlDocumentation.length)
      }
    }

    logger.info('=== getBlocksMetadata FUNCTION COMPLETE ===', {
      success: true,
      resultCount: Object.keys(result).length,
      timestamp: new Date().toISOString(),
    })

    return {
      success: true,
      data: result,
    }
  } catch (error) {
    logger.error('Get block metadata failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      blockIds,
      timestamp: new Date().toISOString(),
    })
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
    subBlocks: [
      {
        id: 'loopType',
        title: 'Loop Type',
        type: 'dropdown',
        required: true,
        options: [
          { label: 'For Loop (count)', id: 'for' },
          { label: 'For Each (collection)', id: 'forEach' },
        ],
      },
      {
        id: 'iterations',
        title: 'Iterations',
        type: 'slider',
        min: 1,
        max: 1000,
        integer: true,
        condition: { field: 'loopType', value: 'for' },
      },
      {
        id: 'collection',
        title: 'Collection',
        type: 'short-input',
        placeholder: 'Array or object to iterate over...',
        condition: { field: 'loopType', value: 'forEach' },
      },
      {
        id: 'maxConcurrency',
        title: 'Max Concurrency',
        type: 'slider',
        min: 1,
        max: 10,
        integer: true,
        default: 1,
      },
    ],
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
    subBlocks: [
      {
        id: 'parallelType',
        title: 'Parallel Type',
        type: 'dropdown',
        required: true,
        options: [
          { label: 'Count (number)', id: 'count' },
          { label: 'Collection (array)', id: 'collection' },
        ],
      },
      {
        id: 'count',
        title: 'Count',
        type: 'slider',
        min: 1,
        max: 100,
        integer: true,
        condition: { field: 'parallelType', value: 'count' },
      },
      {
        id: 'collection',
        title: 'Collection',
        type: 'short-input',
        placeholder: 'Array to process in parallel...',
        condition: { field: 'parallelType', value: 'collection' },
      },
      {
        id: 'maxConcurrency',
        title: 'Max Concurrency',
        type: 'slider',
        min: 1,
        max: 50,
        integer: true,
        default: 10,
      },
    ],
  },
}
