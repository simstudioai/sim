#!/usr/bin/env ts-node
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { glob } from 'glob'

console.log('Starting documentation generator...')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const BLOCKS_PATH = path.join(rootDir, 'apps/sim/blocks/blocks')
const DOCS_OUTPUT_PATH = path.join(rootDir, 'apps/docs/content/docs/en/tools')
const ICONS_PATH = path.join(rootDir, 'apps/sim/components/icons.tsx')
const DOCS_ICONS_PATH = path.join(rootDir, 'apps/docs/components/icons.tsx')

if (!fs.existsSync(DOCS_OUTPUT_PATH)) {
  fs.mkdirSync(DOCS_OUTPUT_PATH, { recursive: true })
}

// Ensure docs components directory exists
const docsComponentsDir = path.dirname(DOCS_ICONS_PATH)
if (!fs.existsSync(docsComponentsDir)) {
  fs.mkdirSync(docsComponentsDir, { recursive: true })
}

interface BlockConfig {
  type: string
  name: string
  description: string
  longDescription?: string
  category: string
  bgColor?: string
  outputs?: Record<string, any>
  tools?: {
    access?: string[]
  }
  [key: string]: any
}

/**
 * Copy the icons.tsx file from the main sim app to the docs app
 * This ensures icons are rendered consistently across both apps
 */
function copyIconsFile(): void {
  try {
    console.log('Copying icons from sim app to docs app...')

    if (!fs.existsSync(ICONS_PATH)) {
      console.error(`Source icons file not found: ${ICONS_PATH}`)
      return
    }

    const iconsContent = fs.readFileSync(ICONS_PATH, 'utf-8')
    fs.writeFileSync(DOCS_ICONS_PATH, iconsContent)

    console.log('✓ Icons successfully copied to docs app')
  } catch (error) {
    console.error('Error copying icons file:', error)
  }
}

/**
 * Generate icon mapping from all block definitions
 * Maps block types to their icon component names
 * Skips blocks that don't have documentation generated (same logic as generateBlockDoc)
 */
async function generateIconMapping(): Promise<Record<string, string>> {
  try {
    console.log('Generating icon mapping from block definitions...')

    const iconMapping: Record<string, string> = {}
    const blockFiles = (await glob(`${BLOCKS_PATH}/*.ts`)).sort()

    for (const blockFile of blockFiles) {
      const fileContent = fs.readFileSync(blockFile, 'utf-8')

      // For icon mapping, we need ALL blocks including hidden ones
      // because V2 blocks inherit icons from legacy blocks via spread
      // First, extract the primary icon from the file (usually the legacy block's icon)
      const primaryIcon = extractIconName(fileContent)

      // Find all block exports and their types
      const exportRegex = /export\s+const\s+(\w+)Block\s*:\s*BlockConfig[^=]*=\s*\{/g
      let match

      while ((match = exportRegex.exec(fileContent)) !== null) {
        const blockName = match[1]
        const startIndex = match.index + match[0].length - 1

        // Extract the block content
        let braceCount = 1
        let endIndex = startIndex + 1

        while (endIndex < fileContent.length && braceCount > 0) {
          if (fileContent[endIndex] === '{') braceCount++
          else if (fileContent[endIndex] === '}') braceCount--
          endIndex++
        }

        if (braceCount === 0) {
          const blockContent = fileContent.substring(startIndex, endIndex)

          // Check hideFromToolbar - skip hidden blocks for docs but NOT for icon mapping
          const hideFromToolbar = /hideFromToolbar\s*:\s*true/.test(blockContent)

          // Get block type
          const blockType =
            extractStringPropertyFromContent(blockContent, 'type') || blockName.toLowerCase()

          // Get icon - either from this block or inherited from primary
          const iconName = extractIconNameFromContent(blockContent) || primaryIcon

          if (!blockType || !iconName) {
            continue
          }

          // Skip trigger/webhook/rss blocks
          if (
            blockType.includes('_trigger') ||
            blockType.includes('_webhook') ||
            blockType.includes('rss')
          ) {
            continue
          }

          // Get category for additional filtering
          const category = extractStringPropertyFromContent(blockContent, 'category') || 'misc'

          if (
            (category === 'blocks' && blockType !== 'memory' && blockType !== 'knowledge') ||
            blockType === 'evaluator' ||
            blockType === 'number' ||
            blockType === 'webhook' ||
            blockType === 'schedule' ||
            blockType === 'mcp' ||
            blockType === 'generic_webhook' ||
            blockType === 'rss'
          ) {
            continue
          }

          // Only add non-hidden blocks to icon mapping (docs won't be generated for hidden)
          if (!hideFromToolbar) {
            iconMapping[blockType] = iconName
          }
        }
      }
    }

    console.log(`✓ Generated icon mapping for ${Object.keys(iconMapping).length} blocks`)
    return iconMapping
  } catch (error) {
    console.error('Error generating icon mapping:', error)
    return {}
  }
}

/**
 * Write the icon mapping to the docs app
 * This file is imported by BlockInfoCard to resolve icons automatically
 */
function writeIconMapping(iconMapping: Record<string, string>): void {
  try {
    const iconMappingPath = path.join(rootDir, 'apps/docs/components/ui/icon-mapping.ts')

    // Get unique icon names
    const iconNames = [...new Set(Object.values(iconMapping))].sort()

    // Generate imports
    const imports = iconNames.map((icon) => `  ${icon},`).join('\n')

    // Generate mapping with direct references (no dynamic access for tree shaking)
    const mappingEntries = Object.entries(iconMapping)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([blockType, iconName]) => `  ${blockType}: ${iconName},`)
      .join('\n')

    const content = `// Auto-generated file - do not edit manually
// Generated by scripts/generate-docs.ts
// Maps block types to their icon component references

import type { ComponentType, SVGProps } from 'react'
import {
${imports}
} from '@/components/icons'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

export const blockTypeToIconMap: Record<string, IconComponent> = {
${mappingEntries}
}
`

    fs.writeFileSync(iconMappingPath, content)
    console.log('✓ Icon mapping file written to docs app')
  } catch (error) {
    console.error('Error writing icon mapping:', error)
  }
}

/**
 * Extract ALL block configs from a file, filtering out hidden blocks
 */
function extractAllBlockConfigs(fileContent: string): BlockConfig[] {
  const configs: BlockConfig[] = []

  // First, extract the primary icon from the file (for V2 blocks that inherit via spread)
  const primaryIcon = extractIconName(fileContent)

  // Find all block exports in the file
  const exportRegex = /export\s+const\s+(\w+)Block\s*:\s*BlockConfig[^=]*=\s*\{/g
  let match

  while ((match = exportRegex.exec(fileContent)) !== null) {
    const blockName = match[1]
    const startIndex = match.index + match[0].length - 1 // Position of opening brace

    // Extract the block content by matching braces
    let braceCount = 1
    let endIndex = startIndex + 1

    while (endIndex < fileContent.length && braceCount > 0) {
      if (fileContent[endIndex] === '{') braceCount++
      else if (fileContent[endIndex] === '}') braceCount--
      endIndex++
    }

    if (braceCount === 0) {
      const blockContent = fileContent.substring(startIndex, endIndex)

      // Check if this block has hideFromToolbar: true
      const hideFromToolbar = /hideFromToolbar\s*:\s*true/.test(blockContent)
      if (hideFromToolbar) {
        console.log(`Skipping ${blockName}Block - hideFromToolbar is true`)
        continue
      }

      // Pass fileContent to enable spread inheritance resolution
      const config = extractBlockConfigFromContent(blockContent, blockName, fileContent)
      if (config) {
        // For V2 blocks that don't have an explicit icon, use the primary icon from the file
        if (!config.iconName && primaryIcon) {
          ;(config as any).iconName = primaryIcon
        }
        configs.push(config)
      }
    }
  }

  return configs
}

/**
 * Extract the name of the spread base block (e.g., "GitHubBlock" from "...GitHubBlock")
 */
function extractSpreadBase(blockContent: string): string | null {
  const spreadMatch = blockContent.match(/^\s*\.\.\.(\w+Block)\s*,/m)
  return spreadMatch ? spreadMatch[1] : null
}

/**
 * Extract block config from a specific block's content
 * If the block uses spread inheritance (e.g., ...GitHubBlock), attempts to resolve
 * missing properties from the base block in the file content.
 */
function extractBlockConfigFromContent(
  blockContent: string,
  blockName: string,
  fileContent?: string
): BlockConfig | null {
  try {
    // Check for spread inheritance
    const spreadBase = extractSpreadBase(blockContent)
    let baseConfig: BlockConfig | null = null

    if (spreadBase && fileContent) {
      // Extract the base block's content from the file
      const baseBlockRegex = new RegExp(
        `export\\s+const\\s+${spreadBase}\\s*:\\s*BlockConfig[^=]*=\\s*\\{`,
        'g'
      )
      const baseMatch = baseBlockRegex.exec(fileContent)

      if (baseMatch) {
        const startIndex = baseMatch.index + baseMatch[0].length - 1
        let braceCount = 1
        let endIndex = startIndex + 1

        while (endIndex < fileContent.length && braceCount > 0) {
          if (fileContent[endIndex] === '{') braceCount++
          else if (fileContent[endIndex] === '}') braceCount--
          endIndex++
        }

        if (braceCount === 0) {
          const baseBlockContent = fileContent.substring(startIndex, endIndex)
          // Recursively extract base config (but don't pass fileContent to avoid infinite loops)
          baseConfig = extractBlockConfigFromContent(
            baseBlockContent,
            spreadBase.replace('Block', '')
          )
        }
      }
    }

    // Extract properties from this block, using topLevelOnly=true for main properties
    const blockType =
      extractStringPropertyFromContent(blockContent, 'type', true) || blockName.toLowerCase()
    const name =
      extractStringPropertyFromContent(blockContent, 'name', true) ||
      baseConfig?.name ||
      `${blockName} Block`
    const description =
      extractStringPropertyFromContent(blockContent, 'description', true) ||
      baseConfig?.description ||
      ''
    const longDescription =
      extractStringPropertyFromContent(blockContent, 'longDescription', true) ||
      baseConfig?.longDescription ||
      ''
    const category =
      extractStringPropertyFromContent(blockContent, 'category', true) ||
      baseConfig?.category ||
      'misc'
    const bgColor =
      extractStringPropertyFromContent(blockContent, 'bgColor', true) ||
      baseConfig?.bgColor ||
      '#F5F5F5'
    const iconName = extractIconNameFromContent(blockContent) || (baseConfig as any)?.iconName || ''

    const outputs = extractOutputsFromContent(blockContent)
    const toolsAccess = extractToolsAccessFromContent(blockContent)

    // For tools.access, if not found directly, check if it's derived from base via map
    let finalToolsAccess = toolsAccess
    if (toolsAccess.length === 0 && baseConfig?.tools?.access) {
      // Check if there's a map operation on base tools
      // Pattern: access: (SomeBlock.tools?.access || []).map((toolId) => `${toolId}_v2`)
      const mapMatch = blockContent.match(
        /access\s*:\s*\(\s*\w+Block\.tools\?\.access\s*\|\|\s*\[\]\s*\)\.map\s*\(\s*\(\s*\w+\s*\)\s*=>\s*`\$\{\s*\w+\s*\}_v(\d+)`\s*\)/
      )
      if (mapMatch) {
        // V2 block - append the version suffix to base tools
        const versionSuffix = `_v${mapMatch[1]}`
        finalToolsAccess = baseConfig.tools.access.map((tool) => `${tool}${versionSuffix}`)
      }
    }

    return {
      type: blockType,
      name,
      description,
      longDescription,
      category,
      bgColor,
      iconName,
      outputs,
      tools: {
        access: finalToolsAccess.length > 0 ? finalToolsAccess : baseConfig?.tools?.access || [],
      },
    }
  } catch (error) {
    console.error(`Error extracting block configuration for ${blockName}:`, error)
    return null
  }
}

/**
 * Strip version suffix (e.g., _v2, _v3) from a type for display purposes
 * The internal type remains unchanged for icon mapping
 */
function stripVersionSuffix(type: string): string {
  return type.replace(/_v\d+$/, '')
}

/**
 * Extract a string property from block content.
 * For top-level properties like 'description', only looks in the portion before nested objects
 * to avoid matching properties inside nested structures like outputs.
 */
function extractStringPropertyFromContent(
  content: string,
  propName: string,
  topLevelOnly = false
): string | null {
  let searchContent = content

  // For top-level properties, only search before nested objects like outputs, tools, inputs, subBlocks
  if (topLevelOnly) {
    const nestedObjectPatterns = [
      /\boutputs\s*:\s*\{/,
      /\btools\s*:\s*\{/,
      /\binputs\s*:\s*\{/,
      /\bsubBlocks\s*:\s*\[/,
      /\btriggers\s*:\s*\{/,
    ]

    let cutoffIndex = content.length
    for (const pattern of nestedObjectPatterns) {
      const match = content.match(pattern)
      if (match && match.index !== undefined && match.index < cutoffIndex) {
        cutoffIndex = match.index
      }
    }
    searchContent = content.substring(0, cutoffIndex)
  }

  const singleQuoteMatch = searchContent.match(new RegExp(`${propName}\\s*:\\s*'([^']*)'`, 'm'))
  if (singleQuoteMatch) return singleQuoteMatch[1]

  const doubleQuoteMatch = searchContent.match(new RegExp(`${propName}\\s*:\\s*"([^"]*)"`, 'm'))
  if (doubleQuoteMatch) return doubleQuoteMatch[1]

  const templateMatch = searchContent.match(new RegExp(`${propName}\\s*:\\s*\`([^\`]+)\``, 's'))
  if (templateMatch) {
    let templateContent = templateMatch[1]
    templateContent = templateContent.replace(/\$\{[^}]+\}/g, '')
    templateContent = templateContent.replace(/\s+/g, ' ').trim()
    return templateContent
  }

  return null
}

function extractIconNameFromContent(content: string): string | null {
  const iconMatch = content.match(/icon\s*:\s*(\w+Icon)/)
  return iconMatch ? iconMatch[1] : null
}

function extractOutputsFromContent(content: string): Record<string, any> {
  const outputsStart = content.search(/outputs\s*:\s*{/)
  if (outputsStart === -1) return {}

  const openBracePos = content.indexOf('{', outputsStart)
  if (openBracePos === -1) return {}

  let braceCount = 1
  let pos = openBracePos + 1

  while (pos < content.length && braceCount > 0) {
    if (content[pos] === '{') braceCount++
    else if (content[pos] === '}') braceCount--
    pos++
  }

  if (braceCount === 0) {
    const outputsContent = content.substring(openBracePos + 1, pos - 1).trim()
    const outputs: Record<string, any> = {}

    const fieldRegex = /(\w+)\s*:\s*{/g
    let match
    const fieldPositions: Array<{ name: string; start: number }> = []

    while ((match = fieldRegex.exec(outputsContent)) !== null) {
      fieldPositions.push({
        name: match[1],
        start: match.index + match[0].length - 1,
      })
    }

    fieldPositions.forEach((field) => {
      const startPos = field.start
      let braceCount = 1
      let endPos = startPos + 1

      while (endPos < outputsContent.length && braceCount > 0) {
        if (outputsContent[endPos] === '{') braceCount++
        else if (outputsContent[endPos] === '}') braceCount--
        endPos++
      }

      if (braceCount === 0) {
        const fieldContent = outputsContent.substring(startPos + 1, endPos - 1).trim()

        const typeMatch = fieldContent.match(/type\s*:\s*['"](.*?)['"]/)
        const descriptionMatch = fieldContent.match(/description\s*:\s*['"](.*?)['"]/)

        if (typeMatch) {
          outputs[field.name] = {
            type: typeMatch[1],
            description: descriptionMatch
              ? descriptionMatch[1]
              : `${field.name} output from the block`,
          }
        }
      }
    })

    if (Object.keys(outputs).length > 0) {
      return outputs
    }
  }

  return {}
}

function extractToolsAccessFromContent(content: string): string[] {
  const accessMatch = content.match(/access\s*:\s*\[\s*([^\]]+)\s*\]/)
  if (!accessMatch) return []

  const accessContent = accessMatch[1]
  const tools: string[] = []

  const toolMatches = accessContent.match(/['"]([^'"]+)['"]/g)
  if (toolMatches) {
    toolMatches.forEach((toolText) => {
      const match = toolText.match(/['"]([^'"]+)['"]/)
      if (match) {
        tools.push(match[1])
      }
    })
  }

  return tools
}

// Legacy function for backward compatibility (icon mapping, etc.)
function extractBlockConfig(fileContent: string): BlockConfig | null {
  const configs = extractAllBlockConfigs(fileContent)
  // Return first non-hidden block for legacy code paths
  return configs.length > 0 ? configs[0] : null
}

function findBlockType(content: string, blockName: string): string {
  const blockExportRegex = new RegExp(
    `export\\s+const\\s+${blockName}Block\\s*:[^{]*{[\\s\\S]*?type\\s*:\\s*['"]([^'"]+)['"][\\s\\S]*?}`,
    'i'
  )
  const blockExportMatch = content.match(blockExportRegex)
  if (blockExportMatch) return blockExportMatch[1]

  const exportMatch = content.match(new RegExp(`export\\s+const\\s+${blockName}Block\\s*:`))
  if (exportMatch) {
    const afterExport = content.substring(exportMatch.index! + exportMatch[0].length)

    const blockStartMatch = afterExport.match(/{/)
    if (blockStartMatch) {
      const blockStart = blockStartMatch.index!

      let braceCount = 1
      let blockEnd = blockStart + 1

      while (blockEnd < afterExport.length && braceCount > 0) {
        if (afterExport[blockEnd] === '{') braceCount++
        else if (afterExport[blockEnd] === '}') braceCount--
        blockEnd++
      }

      const blockContent = afterExport.substring(blockStart, blockEnd)
      const typeMatch = blockContent.match(/type\s*:\s*['"]([^'"]+)['"]/)
      if (typeMatch) return typeMatch[1]
    }
  }

  return blockName
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
}

function extractStringProperty(content: string, propName: string): string | null {
  const singleQuoteMatch = content.match(new RegExp(`${propName}\\s*:\\s*'(.*?)'`, 'm'))
  if (singleQuoteMatch) return singleQuoteMatch[1]

  const doubleQuoteMatch = content.match(new RegExp(`${propName}\\s*:\\s*"(.*?)"`, 'm'))
  if (doubleQuoteMatch) return doubleQuoteMatch[1]

  const templateMatch = content.match(new RegExp(`${propName}\\s*:\\s*\`([^\`]+)\``, 's'))
  if (templateMatch) {
    let templateContent = templateMatch[1]

    templateContent = templateContent.replace(
      /\$\{[^}]*shouldEnableURLInput[^}]*\?[^:]*:[^}]*\}/g,
      'Upload files directly. '
    )
    templateContent = templateContent.replace(/\$\{[^}]*shouldEnableURLInput[^}]*\}/g, 'false')

    templateContent = templateContent.replace(/\$\{[^}]+\}/g, '')

    templateContent = templateContent.replace(/\s+/g, ' ').trim()

    return templateContent
  }

  return null
}

function extractIconName(content: string): string | null {
  const iconMatch = content.match(/icon\s*:\s*(\w+Icon)/)
  return iconMatch ? iconMatch[1] : null
}

function extractOutputs(content: string): Record<string, any> {
  const outputsStart = content.search(/outputs\s*:\s*{/)
  if (outputsStart === -1) return {}

  const openBracePos = content.indexOf('{', outputsStart)
  if (openBracePos === -1) return {}

  let braceCount = 1
  let pos = openBracePos + 1

  while (pos < content.length && braceCount > 0) {
    if (content[pos] === '{') {
      braceCount++
    } else if (content[pos] === '}') {
      braceCount--
    }
    pos++
  }

  if (braceCount === 0) {
    const outputsContent = content.substring(openBracePos + 1, pos - 1).trim()
    const outputs: Record<string, any> = {}

    const fieldRegex = /(\w+)\s*:\s*{/g
    let match
    const fieldPositions: Array<{ name: string; start: number }> = []

    while ((match = fieldRegex.exec(outputsContent)) !== null) {
      fieldPositions.push({
        name: match[1],
        start: match.index + match[0].length - 1,
      })
    }

    fieldPositions.forEach((field) => {
      const startPos = field.start
      let braceCount = 1
      let endPos = startPos + 1

      while (endPos < outputsContent.length && braceCount > 0) {
        if (outputsContent[endPos] === '{') {
          braceCount++
        } else if (outputsContent[endPos] === '}') {
          braceCount--
        }
        endPos++
      }

      if (braceCount === 0) {
        const fieldContent = outputsContent.substring(startPos + 1, endPos - 1).trim()

        const typeMatch = fieldContent.match(/type\s*:\s*['"](.*?)['"]/)
        const descriptionMatch = fieldContent.match(/description\s*:\s*['"](.*?)['"]/)

        if (typeMatch) {
          outputs[field.name] = {
            type: typeMatch[1],
            description: descriptionMatch
              ? descriptionMatch[1]
              : `${field.name} output from the block`,
          }
        }
      }
    })

    if (Object.keys(outputs).length > 0) {
      return outputs
    }

    const flatFieldMatches = outputsContent.match(/(\w+)\s*:\s*['"](.*?)['"]/g)

    if (flatFieldMatches && flatFieldMatches.length > 0) {
      flatFieldMatches.forEach((fieldMatch) => {
        const fieldParts = fieldMatch.match(/(\w+)\s*:\s*['"](.*?)['"]/)
        if (fieldParts) {
          const fieldName = fieldParts[1]
          const fieldType = fieldParts[2]

          outputs[fieldName] = {
            type: fieldType,
            description: `${fieldName} output from the block`,
          }
        }
      })

      if (Object.keys(outputs).length > 0) {
        return outputs
      }
    }
  }

  return {}
}

function extractToolsAccess(content: string): string[] {
  const accessMatch = content.match(/access\s*:\s*\[\s*([^\]]+)\s*\]/)
  if (!accessMatch) return []

  const accessContent = accessMatch[1]
  const tools: string[] = []

  const toolMatches = accessContent.match(/['"]([^'"]+)['"]/g)
  if (toolMatches) {
    toolMatches.forEach((toolText) => {
      const match = toolText.match(/['"]([^'"]+)['"]/)
      if (match) {
        tools.push(match[1])
      }
    })
  }

  return tools
}

function extractToolInfo(
  toolName: string,
  fileContent: string
): {
  description: string
  params: Array<{ name: string; type: string; required: boolean; description: string }>
  outputs: Record<string, any>
} | null {
  try {
    // First, try to find the specific tool definition by its ID
    // Look for: id: 'toolName' or id: "toolName"
    const toolIdRegex = new RegExp(`id:\\s*['"]${toolName}['"]`)
    const toolIdMatch = fileContent.match(toolIdRegex)

    let toolContent = fileContent
    if (toolIdMatch && toolIdMatch.index !== undefined) {
      // Find the tool definition block that contains this ID
      // Search backwards for 'export const' or start of object
      const beforeId = fileContent.substring(0, toolIdMatch.index)
      const exportMatch = beforeId.match(/export\s+const\s+\w+[^=]*=\s*\{[\s\S]*$/)

      if (exportMatch && exportMatch.index !== undefined) {
        const startIndex = exportMatch.index + exportMatch[0].length - 1
        let braceCount = 1
        let endIndex = startIndex + 1

        while (endIndex < fileContent.length && braceCount > 0) {
          if (fileContent[endIndex] === '{') braceCount++
          else if (fileContent[endIndex] === '}') braceCount--
          endIndex++
        }

        if (braceCount === 0) {
          toolContent = fileContent.substring(startIndex, endIndex)
        }
      }
    }

    // Params are often inherited via spread, so search the full file for params
    const toolConfigRegex =
      /params\s*:\s*{([\s\S]*?)},?\s*(?:outputs|oauth|request|directExecution|postProcess|transformResponse)\s*:/
    const toolConfigMatch = fileContent.match(toolConfigRegex)

    // Description should come from the specific tool block if found
    // Only search before nested objects (params, outputs, request, etc.) to avoid matching
    // descriptions inside outputs or params
    let descriptionSearchContent = toolContent
    const nestedObjectPatterns = [
      /\bparams\s*:\s*[{]/,
      /\boutputs\s*:\s*\{/,
      /\brequest\s*:\s*\{/,
      /\boauth\s*:\s*\{/,
      /\btransformResponse\s*:/,
    ]
    let cutoffIndex = toolContent.length
    for (const pattern of nestedObjectPatterns) {
      const match = toolContent.match(pattern)
      if (match && match.index !== undefined && match.index < cutoffIndex) {
        cutoffIndex = match.index
      }
    }
    descriptionSearchContent = toolContent.substring(0, cutoffIndex)

    const descriptionRegex = /description\s*:\s*['"](.*?)['"].*/
    let descriptionMatch = descriptionSearchContent.match(descriptionRegex)

    // If description isn't found as a literal (might be inherited like description: baseTool.description),
    // try to find the referenced tool's description
    if (!descriptionMatch) {
      const inheritedDescMatch = descriptionSearchContent.match(
        /description\s*:\s*(\w+)Tool\.description/
      )
      if (inheritedDescMatch) {
        const baseTool = inheritedDescMatch[1]
        // Try to find the base tool's description in the file
        const baseToolDescRegex = new RegExp(
          `export\\s+const\\s+${baseTool}Tool[^{]*\\{[\\s\\S]*?description\\s*:\\s*['"]([^'"]+)['"]`,
          'i'
        )
        const baseToolMatch = fileContent.match(baseToolDescRegex)
        if (baseToolMatch) {
          descriptionMatch = baseToolMatch
        }
      }
    }

    const description = descriptionMatch ? descriptionMatch[1] : 'No description available'

    const params: Array<{ name: string; type: string; required: boolean; description: string }> = []

    if (toolConfigMatch) {
      const paramsContent = toolConfigMatch[1]

      const paramBlocksRegex = /(\w+)\s*:\s*{/g
      let paramMatch
      const paramPositions: Array<{ name: string; start: number; content: string }> = []

      while ((paramMatch = paramBlocksRegex.exec(paramsContent)) !== null) {
        const paramName = paramMatch[1]
        const startPos = paramMatch.index + paramMatch[0].length - 1

        let braceCount = 1
        let endPos = startPos + 1

        while (endPos < paramsContent.length && braceCount > 0) {
          if (paramsContent[endPos] === '{') {
            braceCount++
          } else if (paramsContent[endPos] === '}') {
            braceCount--
          }
          endPos++
        }

        if (braceCount === 0) {
          const paramBlock = paramsContent.substring(startPos + 1, endPos - 1).trim()
          paramPositions.push({ name: paramName, start: startPos, content: paramBlock })
        }
      }

      for (const param of paramPositions) {
        const paramName = param.name
        const paramBlock = param.content

        if (paramName === 'accessToken' || paramName === 'params' || paramName === 'tools') {
          continue
        }

        const typeMatch = paramBlock.match(/type\s*:\s*['"]([^'"]+)['"]/)
        const requiredMatch = paramBlock.match(/required\s*:\s*(true|false)/)

        let descriptionMatch = paramBlock.match(/description\s*:\s*'(.*?)'(?=\s*[,}])/s)
        if (!descriptionMatch) {
          descriptionMatch = paramBlock.match(/description\s*:\s*"(.*?)"(?=\s*[,}])/s)
        }
        if (!descriptionMatch) {
          descriptionMatch = paramBlock.match(/description\s*:\s*`([^`]+)`/s)
        }
        if (!descriptionMatch) {
          descriptionMatch = paramBlock.match(
            /description\s*:\s*['"]([^'"]*(?:\n[^'"]*)*?)['"](?=\s*[,}])/s
          )
        }

        params.push({
          name: paramName,
          type: typeMatch ? typeMatch[1] : 'string',
          required: requiredMatch ? requiredMatch[1] === 'true' : false,
          description: descriptionMatch ? descriptionMatch[1] : 'No description',
        })
      }
    }

    let outputs: Record<string, any> = {}
    // Use word boundary to avoid matching 'run_outputs' or similar param names
    const outputsStart = toolContent.search(/(?<![a-zA-Z_])outputs\s*:\s*{/)
    if (outputsStart !== -1) {
      const openBracePos = toolContent.indexOf('{', outputsStart)
      if (openBracePos !== -1) {
        let braceCount = 1
        let pos = openBracePos + 1
        while (pos < toolContent.length && braceCount > 0) {
          if (toolContent[pos] === '{') braceCount++
          else if (toolContent[pos] === '}') braceCount--
          pos++
        }
        if (braceCount === 0) {
          const outputsContent = toolContent.substring(openBracePos + 1, pos - 1).trim()
          outputs = parseToolOutputsField(outputsContent)
        }
      }
    }

    return {
      description,
      params,
      outputs,
    }
  } catch (error) {
    console.error(`Error extracting info for tool ${toolName}:`, error)
    return null
  }
}

function formatOutputStructure(outputs: Record<string, any>, indentLevel = 0): string {
  let result = ''

  for (const [key, output] of Object.entries(outputs)) {
    let type = 'unknown'
    let description = `${key} output from the tool`

    if (typeof output === 'object' && output !== null) {
      if (output.type) {
        type = output.type
      }

      if (output.description) {
        description = output.description
      }
    }

    const escapedDescription = description
      .replace(/\|/g, '\\|')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

    let prefix = ''
    if (indentLevel === 1) {
      prefix = '↳ '
    } else if (indentLevel >= 2) {
      prefix = '  ↳ '
    }

    if (typeof output === 'object' && output !== null && output.type === 'array') {
      result += `| ${prefix}\`${key}\` | ${type} | ${escapedDescription} |\n`

      if (output.items?.properties) {
        const arrayItemsResult = formatOutputStructure(output.items.properties, indentLevel + 2)
        result += arrayItemsResult
      }
    } else if (
      typeof output === 'object' &&
      output !== null &&
      output.properties &&
      (output.type === 'object' || output.type === 'json')
    ) {
      result += `| ${prefix}\`${key}\` | ${type} | ${escapedDescription} |\n`

      const nestedResult = formatOutputStructure(output.properties, indentLevel + 1)
      result += nestedResult
    } else {
      result += `| ${prefix}\`${key}\` | ${type} | ${escapedDescription} |\n`
    }
  }

  return result
}

function parseToolOutputsField(outputsContent: string): Record<string, any> {
  const outputs: Record<string, any> = {}

  const braces: Array<{ type: 'open' | 'close'; pos: number; level: number }> = []
  for (let i = 0; i < outputsContent.length; i++) {
    if (outputsContent[i] === '{') {
      braces.push({ type: 'open', pos: i, level: 0 })
    } else if (outputsContent[i] === '}') {
      braces.push({ type: 'close', pos: i, level: 0 })
    }
  }

  let currentLevel = 0
  for (const brace of braces) {
    if (brace.type === 'open') {
      brace.level = currentLevel
      currentLevel++
    } else {
      currentLevel--
      brace.level = currentLevel
    }
  }

  const fieldStartRegex = /(\w+)\s*:\s*{/g
  let match
  const fieldPositions: Array<{ name: string; start: number; end: number; level: number }> = []

  while ((match = fieldStartRegex.exec(outputsContent)) !== null) {
    const fieldName = match[1]
    const bracePos = match.index + match[0].length - 1

    const openBrace = braces.find((b) => b.type === 'open' && b.pos === bracePos)
    if (openBrace) {
      let braceCount = 1
      let endPos = bracePos + 1

      while (endPos < outputsContent.length && braceCount > 0) {
        if (outputsContent[endPos] === '{') {
          braceCount++
        } else if (outputsContent[endPos] === '}') {
          braceCount--
        }
        endPos++
      }

      fieldPositions.push({
        name: fieldName,
        start: bracePos,
        end: endPos,
        level: openBrace.level,
      })
    }
  }

  const topLevelFields = fieldPositions.filter((f) => f.level === 0)

  topLevelFields.forEach((field) => {
    const fieldContent = outputsContent.substring(field.start + 1, field.end - 1).trim()

    const parsedField = parseFieldContent(fieldContent)
    if (parsedField) {
      outputs[field.name] = parsedField
    }
  })

  return outputs
}

function parseFieldContent(fieldContent: string): any {
  const typeMatch = fieldContent.match(/type\s*:\s*['"]([^'"]+)['"]/)
  const descMatch = fieldContent.match(/description\s*:\s*['"`]([^'"`\n]+)['"`]/)

  if (!typeMatch) return null

  const fieldType = typeMatch[1]
  const description = descMatch ? descMatch[1] : ''

  const result: any = {
    type: fieldType,
    description: description,
  }

  if (fieldType === 'object' || fieldType === 'json') {
    const propertiesRegex = /properties\s*:\s*{/
    const propertiesStart = fieldContent.search(propertiesRegex)

    if (propertiesStart !== -1) {
      const braceStart = fieldContent.indexOf('{', propertiesStart)
      let braceCount = 1
      let braceEnd = braceStart + 1

      while (braceEnd < fieldContent.length && braceCount > 0) {
        if (fieldContent[braceEnd] === '{') braceCount++
        else if (fieldContent[braceEnd] === '}') braceCount--
        braceEnd++
      }

      if (braceCount === 0) {
        const propertiesContent = fieldContent.substring(braceStart + 1, braceEnd - 1).trim()
        result.properties = parsePropertiesContent(propertiesContent)
      }
    }
  }

  const itemsRegex = /items\s*:\s*{/
  const itemsStart = fieldContent.search(itemsRegex)

  if (itemsStart !== -1) {
    const braceStart = fieldContent.indexOf('{', itemsStart)
    let braceCount = 1
    let braceEnd = braceStart + 1

    while (braceEnd < fieldContent.length && braceCount > 0) {
      if (fieldContent[braceEnd] === '{') braceCount++
      else if (fieldContent[braceEnd] === '}') braceCount--
      braceEnd++
    }

    if (braceCount === 0) {
      const itemsContent = fieldContent.substring(braceStart + 1, braceEnd - 1).trim()
      const itemsType = itemsContent.match(/type\s*:\s*['"]([^'"]+)['"]/)

      const propertiesStart = itemsContent.search(/properties\s*:\s*{/)
      const searchContent =
        propertiesStart >= 0 ? itemsContent.substring(0, propertiesStart) : itemsContent
      const itemsDesc = searchContent.match(/description\s*:\s*['"`]([^'"`\n]+)['"`]/)

      result.items = {
        type: itemsType ? itemsType[1] : 'object',
        description: itemsDesc ? itemsDesc[1] : '',
      }

      const itemsPropertiesRegex = /properties\s*:\s*{/
      const itemsPropsStart = itemsContent.search(itemsPropertiesRegex)

      if (itemsPropsStart !== -1) {
        const propsBraceStart = itemsContent.indexOf('{', itemsPropsStart)
        let propsBraceCount = 1
        let propsBraceEnd = propsBraceStart + 1

        while (propsBraceEnd < itemsContent.length && propsBraceCount > 0) {
          if (itemsContent[propsBraceEnd] === '{') propsBraceCount++
          else if (itemsContent[propsBraceEnd] === '}') propsBraceCount--
          propsBraceEnd++
        }

        if (propsBraceCount === 0) {
          const itemsPropsContent = itemsContent
            .substring(propsBraceStart + 1, propsBraceEnd - 1)
            .trim()
          result.items.properties = parsePropertiesContent(itemsPropsContent)
        }
      }
    }
  }

  return result
}

function parsePropertiesContent(propertiesContent: string): Record<string, any> {
  const properties: Record<string, any> = {}

  const propStartRegex = /(\w+)\s*:\s*{/g
  let match
  const propPositions: Array<{ name: string; start: number; content: string }> = []

  while ((match = propStartRegex.exec(propertiesContent)) !== null) {
    const propName = match[1]

    if (propName === 'items' || propName === 'properties') {
      continue
    }

    const startPos = match.index + match[0].length - 1

    let braceCount = 1
    let endPos = startPos + 1

    while (endPos < propertiesContent.length && braceCount > 0) {
      if (propertiesContent[endPos] === '{') {
        braceCount++
      } else if (propertiesContent[endPos] === '}') {
        braceCount--
      }
      endPos++
    }

    if (braceCount === 0) {
      const propContent = propertiesContent.substring(startPos + 1, endPos - 1).trim()

      const hasDescription = /description\s*:\s*/.test(propContent)
      const hasProperties = /properties\s*:\s*{/.test(propContent)
      const hasItems = /items\s*:\s*{/.test(propContent)
      const isTypeOnly =
        !hasDescription &&
        !hasProperties &&
        !hasItems &&
        /^type\s*:\s*['"].*?['"]\s*,?\s*$/.test(propContent)

      if (!isTypeOnly) {
        propPositions.push({
          name: propName,
          start: startPos,
          content: propContent,
        })
      }
    }
  }

  propPositions.forEach((prop) => {
    const parsedProp = parseFieldContent(prop.content)
    if (parsedProp) {
      properties[prop.name] = parsedProp
    }
  })

  return properties
}

async function getToolInfo(toolName: string): Promise<{
  description: string
  params: Array<{ name: string; type: string; required: boolean; description: string }>
  outputs: Record<string, any>
} | null> {
  try {
    const parts = toolName.split('_')

    let toolPrefix = ''
    let toolSuffix = ''

    for (let i = parts.length - 1; i >= 1; i--) {
      const possiblePrefix = parts.slice(0, i).join('_')
      const possibleSuffix = parts.slice(i).join('_')

      const toolDirPath = path.join(rootDir, `apps/sim/tools/${possiblePrefix}`)

      if (fs.existsSync(toolDirPath) && fs.statSync(toolDirPath).isDirectory()) {
        toolPrefix = possiblePrefix
        toolSuffix = possibleSuffix
        break
      }
    }

    if (!toolPrefix) {
      toolPrefix = parts[0]
      toolSuffix = parts.slice(1).join('_')
    }

    // Check if this is a versioned tool (e.g., _v2, _v3)
    const isVersionedTool = /_v\d+$/.test(toolSuffix)
    const strippedToolSuffix = stripVersionSuffix(toolSuffix)

    const possibleLocations: Array<{ path: string; priority: 'exact' | 'fallback' }> = []

    // For versioned tools, prioritize the exact versioned file first
    // This handles cases like google_sheets where V2 is in a separate file (read_v2.ts)
    if (isVersionedTool) {
      // First priority: exact versioned file (e.g., read_v2.ts)
      possibleLocations.push({
        path: path.join(rootDir, `apps/sim/tools/${toolPrefix}/${toolSuffix}.ts`),
        priority: 'exact',
      })
      // Second priority: stripped file that contains both V1 and V2 (e.g., pr.ts for github)
      possibleLocations.push({
        path: path.join(rootDir, `apps/sim/tools/${toolPrefix}/${strippedToolSuffix}.ts`),
        priority: 'fallback',
      })
    } else {
      // Non-versioned tool: try the direct file
      possibleLocations.push({
        path: path.join(rootDir, `apps/sim/tools/${toolPrefix}/${toolSuffix}.ts`),
        priority: 'exact',
      })
    }

    // Also try camelCase versions
    const camelCaseSuffix = strippedToolSuffix
      .split('_')
      .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
      .join('')
    possibleLocations.push({
      path: path.join(rootDir, `apps/sim/tools/${toolPrefix}/${camelCaseSuffix}.ts`),
      priority: 'fallback',
    })

    // Fall back to index.ts
    possibleLocations.push({
      path: path.join(rootDir, `apps/sim/tools/${toolPrefix}/index.ts`),
      priority: 'fallback',
    })

    let toolFileContent = ''
    let foundFile = ''

    // Try to find a file that contains the exact tool ID
    for (const location of possibleLocations) {
      if (fs.existsSync(location.path)) {
        const content = fs.readFileSync(location.path, 'utf-8')

        // Check if this file contains the exact tool ID we're looking for
        const toolIdRegex = new RegExp(`id:\\s*['"]${toolName}['"]`)
        if (toolIdRegex.test(content)) {
          toolFileContent = content
          foundFile = location.path
          break
        }

        // For fallback locations, store the content in case we don't find an exact match
        if (location.priority === 'fallback' && !toolFileContent) {
          toolFileContent = content
          foundFile = location.path
        }
      }
    }

    // If we didn't find a file with the exact ID, use the first available file
    if (!toolFileContent) {
      for (const location of possibleLocations) {
        if (fs.existsSync(location.path)) {
          toolFileContent = fs.readFileSync(location.path, 'utf-8')
          foundFile = location.path
          break
        }
      }
    }

    if (!toolFileContent) {
      console.warn(`Could not find definition for tool: ${toolName}`)
      return null
    }

    return extractToolInfo(toolName, toolFileContent)
  } catch (error) {
    console.error(`Error getting info for tool ${toolName}:`, error)
    return null
  }
}

function extractManualContent(existingContent: string): Record<string, string> {
  const manualSections: Record<string, string> = {}
  const manualContentRegex =
    /\{\/\*\s*MANUAL-CONTENT-START:(\w+)\s*\*\/\}([\s\S]*?)\{\/\*\s*MANUAL-CONTENT-END\s*\*\/\}/g

  let match
  while ((match = manualContentRegex.exec(existingContent)) !== null) {
    const sectionName = match[1]
    const content = match[2].trim()
    manualSections[sectionName] = content
  }

  return manualSections
}

function mergeWithManualContent(
  generatedMarkdown: string,
  existingContent: string | null,
  manualSections: Record<string, string>
): string {
  if (!existingContent || Object.keys(manualSections).length === 0) {
    return generatedMarkdown
  }

  let mergedContent = generatedMarkdown

  Object.entries(manualSections).forEach(([sectionName, content]) => {
    const insertionPoints: Record<string, { regex: RegExp }> = {
      intro: {
        regex: /<BlockInfoCard[\s\S]*?(\/>|<\/svg>`}\s*\/>)/,
      },
      usage: {
        regex: /## Usage Instructions/,
      },
      outputs: {
        regex: /## Outputs/,
      },
      notes: {
        regex: /## Notes/,
      },
    }

    const insertionPoint = insertionPoints[sectionName]

    if (insertionPoint) {
      const match = mergedContent.match(insertionPoint.regex)

      if (match && match.index !== undefined) {
        const insertPosition = match.index + match[0].length
        mergedContent = `${mergedContent.slice(0, insertPosition)}\n\n{/* MANUAL-CONTENT-START:${sectionName} */}\n${content}\n{/* MANUAL-CONTENT-END */}\n${mergedContent.slice(insertPosition)}`
      } else {
        console.log(
          `Could not find insertion point for ${sectionName}, regex pattern: ${insertionPoint.regex}`
        )
      }
    } else {
      console.log(`No insertion point defined for section ${sectionName}`)
    }
  })

  return mergedContent
}

async function generateBlockDoc(blockPath: string) {
  try {
    const blockFileName = path.basename(blockPath, '.ts')
    if (blockFileName.endsWith('.test')) {
      return
    }

    const fileContent = fs.readFileSync(blockPath, 'utf-8')

    // Extract ALL block configs from the file (already filters out hideFromToolbar: true)
    const blockConfigs = extractAllBlockConfigs(fileContent)

    if (blockConfigs.length === 0) {
      console.warn(`Skipping ${blockFileName} - no valid block configs found`)
      return
    }

    // Process each block config
    for (const blockConfig of blockConfigs) {
      if (!blockConfig.type) {
        continue
      }

      if (
        blockConfig.type.includes('_trigger') ||
        blockConfig.type.includes('_webhook') ||
        blockConfig.type.includes('rss')
      ) {
        console.log(`Skipping ${blockConfig.type} - contains '_trigger'`)
        continue
      }

      if (
        (blockConfig.category === 'blocks' &&
          blockConfig.type !== 'memory' &&
          blockConfig.type !== 'knowledge') ||
        blockConfig.type === 'evaluator' ||
        blockConfig.type === 'number' ||
        blockConfig.type === 'webhook' ||
        blockConfig.type === 'schedule' ||
        blockConfig.type === 'mcp' ||
        blockConfig.type === 'generic_webhook' ||
        blockConfig.type === 'rss'
      ) {
        continue
      }

      // Use stripped type for file name (removes _v2, _v3 suffixes for cleaner URLs)
      const displayType = stripVersionSuffix(blockConfig.type)
      const outputFilePath = path.join(DOCS_OUTPUT_PATH, `${displayType}.mdx`)

      let existingContent: string | null = null
      if (fs.existsSync(outputFilePath)) {
        existingContent = fs.readFileSync(outputFilePath, 'utf-8')
      }

      const manualSections = existingContent ? extractManualContent(existingContent) : {}

      const markdown = await generateMarkdownForBlock(blockConfig, displayType)

      let finalContent = markdown
      if (Object.keys(manualSections).length > 0) {
        finalContent = mergeWithManualContent(markdown, existingContent, manualSections)
      }

      fs.writeFileSync(outputFilePath, finalContent)
      const logType =
        displayType !== blockConfig.type ? `${displayType} (from ${blockConfig.type})` : displayType
      console.log(`✓ Generated docs for ${logType}`)
    }
  } catch (error) {
    console.error(`Error processing ${blockPath}:`, error)
  }
}

async function generateMarkdownForBlock(
  blockConfig: BlockConfig,
  displayType?: string
): Promise<string> {
  const {
    type,
    name,
    description,
    longDescription,
    category,
    bgColor,
    outputs = {},
    tools = { access: [] },
  } = blockConfig

  let outputsSection = ''

  if (outputs && Object.keys(outputs).length > 0) {
    outputsSection = '## Outputs\n\n'

    outputsSection += '| Output | Type | Description |\n'
    outputsSection += '| ------ | ---- | ----------- |\n'

    for (const outputKey in outputs) {
      const output = outputs[outputKey]

      const escapedDescription = output.description
        ? output.description
            .replace(/\|/g, '\\|')
            .replace(/\{/g, '\\{')
            .replace(/\}/g, '\\}')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)')
            .replace(/\[/g, '\\[')
            .replace(/\]/g, '\\]')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
        : `Output from ${outputKey}`

      if (typeof output.type === 'string') {
        outputsSection += `| \`${outputKey}\` | ${output.type} | ${escapedDescription} |\n`
      } else if (output.type && typeof output.type === 'object') {
        outputsSection += `| \`${outputKey}\` | object | ${escapedDescription} |\n`

        for (const propName in output.type) {
          const propType = output.type[propName]
          const commentMatch =
            propName && output.type[propName]._comment
              ? output.type[propName]._comment
              : `${propName} of the ${outputKey}`

          outputsSection += `| ↳ \`${propName}\` | ${propType} | ${commentMatch} |\n`
        }
      } else if (output.properties) {
        outputsSection += `| \`${outputKey}\` | object | ${escapedDescription} |\n`

        for (const propName in output.properties) {
          const prop = output.properties[propName]
          const escapedPropertyDescription = prop.description
            ? prop.description
                .replace(/\|/g, '\\|')
                .replace(/\{/g, '\\{')
                .replace(/\}/g, '\\}')
                .replace(/\(/g, '\\(')
                .replace(/\)/g, '\\)')
                .replace(/\[/g, '\\[')
                .replace(/\]/g, '\\]')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
            : `The ${propName} of the ${outputKey}`

          outputsSection += `| ↳ \`${propName}\` | ${prop.type} | ${escapedPropertyDescription} |\n`
        }
      }
    }
  } else {
    outputsSection = 'This block does not produce any outputs.'
  }

  let toolsSection = ''
  if (tools.access?.length) {
    toolsSection = '## Tools\n\n'

    for (const tool of tools.access) {
      // Strip version suffix from tool name for display
      const displayToolName = stripVersionSuffix(tool)
      toolsSection += `### \`${displayToolName}\`\n\n`

      console.log(`Getting info for tool: ${tool}`)
      const toolInfo = await getToolInfo(tool)

      if (toolInfo) {
        if (toolInfo.description && toolInfo.description !== 'No description available') {
          toolsSection += `${toolInfo.description}\n\n`
        }

        toolsSection += '#### Input\n\n'
        toolsSection += '| Parameter | Type | Required | Description |\n'
        toolsSection += '| --------- | ---- | -------- | ----------- |\n'

        if (toolInfo.params.length > 0) {
          for (const param of toolInfo.params) {
            const escapedDescription = param.description
              ? param.description
                  .replace(/\|/g, '\\|')
                  .replace(/\{/g, '\\{')
                  .replace(/\}/g, '\\}')
                  .replace(/\(/g, '\\(')
                  .replace(/\)/g, '\\)')
                  .replace(/\[/g, '\\[')
                  .replace(/\]/g, '\\]')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
              : 'No description'

            toolsSection += `| \`${param.name}\` | ${param.type} | ${param.required ? 'Yes' : 'No'} | ${escapedDescription} |\n`
          }
        }

        toolsSection += '\n#### Output\n\n'

        if (Object.keys(toolInfo.outputs).length > 0) {
          toolsSection += '| Parameter | Type | Description |\n'
          toolsSection += '| --------- | ---- | ----------- |\n'

          toolsSection += formatOutputStructure(toolInfo.outputs)
        } else if (Object.keys(outputs).length > 0) {
          toolsSection += '| Parameter | Type | Description |\n'
          toolsSection += '| --------- | ---- | ----------- |\n'

          for (const [key, output] of Object.entries(outputs)) {
            let type = 'string'
            let description = `${key} output from the tool`

            if (typeof output === 'string') {
              type = output
            } else if (typeof output === 'object' && output !== null) {
              if ('type' in output && typeof output.type === 'string') {
                type = output.type
              }
              if ('description' in output && typeof output.description === 'string') {
                description = output.description
              }
            }

            const escapedDescription = description
              .replace(/\|/g, '\\|')
              .replace(/\{/g, '\\{')
              .replace(/\}/g, '\\}')
              .replace(/\(/g, '\\(')
              .replace(/\)/g, '\\)')
              .replace(/\[/g, '\\[')
              .replace(/\]/g, '\\]')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')

            toolsSection += `| \`${key}\` | ${type} | ${escapedDescription} |\n`
          }
        } else {
          toolsSection += 'This tool does not produce any outputs.\n'
        }
      }

      toolsSection += '\n'
    }
  }

  let usageInstructions = ''
  if (longDescription) {
    usageInstructions = `## Usage Instructions\n\n${longDescription}\n\n`
  }

  return `---
title: ${name}
description: ${description}
---

import { BlockInfoCard } from "@/components/ui/block-info-card"

<BlockInfoCard 
  type="${type}"
  color="${bgColor || '#F5F5F5'}"
/>

${usageInstructions}

${toolsSection}
`
}

/**
 * Extract all hidden block types (blocks with hideFromToolbar: true) and
 * the set of display names that will be generated by visible blocks.
 * This is needed to avoid deleting docs for hidden V1 blocks when a visible V2 block
 * will regenerate them.
 */
async function getHiddenAndVisibleBlockTypes(): Promise<{
  hiddenTypes: Set<string>
  visibleDisplayNames: Set<string>
}> {
  const hiddenTypes = new Set<string>()
  const visibleDisplayNames = new Set<string>()
  const blockFiles = (await glob(`${BLOCKS_PATH}/*.ts`)).sort()

  for (const blockFile of blockFiles) {
    const fileContent = fs.readFileSync(blockFile, 'utf-8')

    // Find all block exports
    const exportRegex = /export\s+const\s+(\w+)Block\s*:\s*BlockConfig[^=]*=\s*\{/g
    let match

    while ((match = exportRegex.exec(fileContent)) !== null) {
      const startIndex = match.index + match[0].length - 1

      // Extract the block content
      let braceCount = 1
      let endIndex = startIndex + 1

      while (endIndex < fileContent.length && braceCount > 0) {
        if (fileContent[endIndex] === '{') braceCount++
        else if (fileContent[endIndex] === '}') braceCount--
        endIndex++
      }

      if (braceCount === 0) {
        const blockContent = fileContent.substring(startIndex, endIndex)
        const blockType = extractStringPropertyFromContent(blockContent, 'type', true)

        if (blockType) {
          // Check if this block has hideFromToolbar: true
          if (/hideFromToolbar\s*:\s*true/.test(blockContent)) {
            hiddenTypes.add(blockType)
          } else {
            // This block is visible - add its display name (stripped version)
            visibleDisplayNames.add(stripVersionSuffix(blockType))
          }
        }
      }
    }
  }

  return { hiddenTypes, visibleDisplayNames }
}

/**
 * Remove documentation files for hidden blocks.
 * Skips deletion if a visible V2 block will regenerate the docs.
 */
function cleanupHiddenBlockDocs(hiddenTypes: Set<string>, visibleDisplayNames: Set<string>): void {
  console.log('Cleaning up docs for hidden blocks...')

  // Create a set of stripped hidden types (for matching doc files without version suffix)
  const strippedHiddenTypes = new Set<string>()
  for (const type of hiddenTypes) {
    strippedHiddenTypes.add(stripVersionSuffix(type))
  }

  const existingDocs = fs
    .readdirSync(DOCS_OUTPUT_PATH)
    .filter((file: string) => file.endsWith('.mdx'))

  let removedCount = 0

  for (const docFile of existingDocs) {
    const blockType = path.basename(docFile, '.mdx')

    // Check both original type and stripped type (since doc files use stripped names)
    if (hiddenTypes.has(blockType) || strippedHiddenTypes.has(blockType)) {
      // Skip deletion if there's a visible V2 block that will regenerate this doc
      // (e.g., don't delete intercom.mdx if IntercomV2Block is visible)
      if (visibleDisplayNames.has(blockType)) {
        console.log(`  Skipping deletion of ${blockType}.mdx - visible V2 block will regenerate it`)
        continue
      }

      const docPath = path.join(DOCS_OUTPUT_PATH, docFile)
      fs.unlinkSync(docPath)
      console.log(`✓ Removed docs for hidden block: ${blockType}`)
      removedCount++
    }
  }

  if (removedCount > 0) {
    console.log(`✓ Cleaned up ${removedCount} doc files for hidden blocks`)
  } else {
    console.log('✓ No hidden block docs to clean up')
  }
}

async function generateAllBlockDocs() {
  try {
    // Copy icons from sim app to docs app
    copyIconsFile()

    // Generate icon mapping from block definitions
    const iconMapping = await generateIconMapping()
    writeIconMapping(iconMapping)

    // Get hidden and visible block types before generating docs
    const { hiddenTypes, visibleDisplayNames } = await getHiddenAndVisibleBlockTypes()
    console.log(`Found ${hiddenTypes.size} hidden blocks: ${[...hiddenTypes].join(', ')}`)

    // Clean up docs for hidden blocks (skipping those with visible V2 equivalents)
    cleanupHiddenBlockDocs(hiddenTypes, visibleDisplayNames)

    const blockFiles = (await glob(`${BLOCKS_PATH}/*.ts`)).sort()

    for (const blockFile of blockFiles) {
      await generateBlockDoc(blockFile)
    }

    updateMetaJson()

    return true
  } catch (error) {
    console.error('Error generating documentation:', error)
    return false
  }
}

function updateMetaJson() {
  const metaJsonPath = path.join(DOCS_OUTPUT_PATH, 'meta.json')

  const blockFiles = fs
    .readdirSync(DOCS_OUTPUT_PATH)
    .filter((file: string) => file.endsWith('.mdx'))
    .map((file: string) => path.basename(file, '.mdx'))

  const items = [
    ...(blockFiles.includes('index') ? ['index'] : []),
    ...blockFiles.filter((file: string) => file !== 'index').sort(),
  ]

  const metaJson = {
    pages: items,
  }

  fs.writeFileSync(metaJsonPath, JSON.stringify(metaJson, null, 2))
  console.log(`Updated meta.json with ${items.length} entries`)
}

generateAllBlockDocs()
  .then((success) => {
    if (success) {
      console.log('Documentation generation completed successfully')
      process.exit(0)
    } else {
      console.error('Documentation generation failed')
      process.exit(1)
    }
  })
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
