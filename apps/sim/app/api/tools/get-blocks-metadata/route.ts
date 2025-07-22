import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { registry as blockRegistry } from '@/blocks/registry'
import { tools as toolsRegistry } from '@/tools/registry'

const logger = createLogger('GetBlockMetadataAPI')

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { blockIds } = body

    if (!blockIds || !Array.isArray(blockIds)) {
      return NextResponse.json(
        {
          success: false,
          error: 'blockIds must be an array of block IDs',
        },
        { status: 400 }
      )
    }

    logger.info('Getting block metadata', {
      blockIds,
      blockCount: blockIds.length,
      requestedBlocks: blockIds.join(', '),
    })

    // Create result object
    const result: Record<string, any> = {}

    for (const blockId of blockIds) {
      const blockConfig = blockRegistry[blockId]

      if (!blockConfig) {
        logger.warn(`Block not found: ${blockId}`)
        continue
      }

      // Always include code schemas from block configuration
      const codeSchemas = {
        inputs: blockConfig.inputs,
        outputs: blockConfig.outputs,
        subBlocks: blockConfig.subBlocks,
      }

      // Check if this is a core block with YAML documentation
      if (CORE_BLOCKS_WITH_DOCS.includes(blockId)) {
        // For core blocks, return both YAML schema from documentation AND code schemas
        const yamlSchema = getYamlSchemaFromDocs(blockId)

        if (yamlSchema) {
          result[blockId] = {
            type: 'block',
            description: blockConfig.description || '',
            longDescription: blockConfig.longDescription,
            category: blockConfig.category || '',
            yamlSchema: yamlSchema,
            docsLink: blockConfig.docsLink,
            // Include actual schemas from code
            codeSchemas: codeSchemas,
          }
        } else {
          // Fallback to regular metadata if YAML schema not found
          result[blockId] = {
            type: 'block',
            description: blockConfig.description || '',
            longDescription: blockConfig.longDescription,
            category: blockConfig.category || '',
            inputs: blockConfig.inputs,
            outputs: blockConfig.outputs,
            subBlocks: blockConfig.subBlocks,
            // Include actual schemas from code
            codeSchemas: codeSchemas,
          }
        }
      } else {
        // For tool blocks, return tool schema information AND code schemas
        const blockTools = blockConfig.tools?.access || []
        const toolSchemas: Record<string, any> = {}

        for (const toolId of blockTools) {
          const toolConfig = toolsRegistry[toolId]
          if (toolConfig) {
            toolSchemas[toolId] = {
              id: toolConfig.id,
              name: toolConfig.name,
              description: toolConfig.description || '',
              version: toolConfig.version,
              params: toolConfig.params,
              request: toolConfig.request
                ? {
                    method: toolConfig.request.method,
                    url: toolConfig.request.url,
                    headers:
                      typeof toolConfig.request.headers === 'function'
                        ? 'function'
                        : toolConfig.request.headers,
                    isInternalRoute: toolConfig.request.isInternalRoute,
                  }
                : undefined,
            }
          } else {
            logger.warn(`Tool not found: ${toolId} for block: ${blockId}`)
            toolSchemas[toolId] = {
              id: toolId,
              description: 'Tool not found',
            }
          }
        }

        result[blockId] = {
          type: 'tool',
          description: blockConfig.description || '',
          longDescription: blockConfig.longDescription,
          category: blockConfig.category || '',
          inputs: blockConfig.inputs,
          outputs: blockConfig.outputs,
          subBlocks: blockConfig.subBlocks,
          toolSchemas: toolSchemas,
          // Include actual schemas from code
          codeSchemas: codeSchemas,
        }
      }
    }

    const processedBlocks = Object.keys(result).length
    const requestedBlocks = blockIds.length
    const notFoundBlocks = requestedBlocks - processedBlocks

    // Log detailed output for debugging
    Object.entries(result).forEach(([blockId, blockData]) => {
      if (blockData.type === 'block' && blockData.yamlSchema) {
        logger.info(`Retrieved YAML schema + code schemas for core block: ${blockId}`, {
          blockId,
          type: blockData.type,
          description: blockData.description,
          yamlSchemaLength: blockData.yamlSchema.length,
          yamlSchemaPreview: `${blockData.yamlSchema.substring(0, 200)}...`,
          hasCodeSchemas: !!blockData.codeSchemas,
          codeSubBlocksCount: blockData.codeSchemas?.subBlocks?.length || 0,
        })
      } else if (blockData.type === 'tool' && blockData.toolSchemas) {
        const toolIds = Object.keys(blockData.toolSchemas)
        logger.info(`Retrieved tool schemas + code schemas for tool block: ${blockId}`, {
          blockId,
          type: blockData.type,
          description: blockData.description,
          toolCount: toolIds.length,
          toolIds: toolIds,
          hasCodeSchemas: !!blockData.codeSchemas,
          codeSubBlocksCount: blockData.codeSchemas?.subBlocks?.length || 0,
        })
      } else {
        logger.info(`Retrieved metadata + code schemas for block: ${blockId}`, {
          blockId,
          type: blockData.type,
          description: blockData.description,
          hasInputs: !!blockData.inputs,
          hasOutputs: !!blockData.outputs,
          hasSubBlocks: !!blockData.subBlocks,
          hasCodeSchemas: !!blockData.codeSchemas,
          codeSubBlocksCount: blockData.codeSchemas?.subBlocks?.length || 0,
        })
      }
    })

    logger.info(`Successfully processed ${processedBlocks} block metadata`, {
      requestedBlocks,
      processedBlocks,
      notFoundBlocks,
      coreBlocks: blockIds.filter((id) => CORE_BLOCKS_WITH_DOCS.includes(id)),
      toolBlocks: blockIds.filter((id) => !CORE_BLOCKS_WITH_DOCS.includes(id)),
    })

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    logger.error('Get block metadata failed', error)
    return NextResponse.json(
      {
        success: false,
        error: `Failed to get block metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
}
