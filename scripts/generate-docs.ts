#!/usr/bin/env ts-node
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { glob } from 'glob'

console.log('Starting documentation generator...')

/**
 * Cache for resolved const definitions from types files.
 * Key: "toolPrefix:constName" (e.g., "calcom:SCHEDULE_DATA_OUTPUT_PROPERTIES")
 * Value: The resolved properties object
 */
const constResolutionCache = new Map<string, Record<string, any>>()

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
        const description = extractDescription(fieldContent)

        if (typeMatch) {
          outputs[field.name] = {
            type: typeMatch[1],
            description: description || `${field.name} output from the block`,
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
        const description = extractDescription(fieldContent)

        if (typeMatch) {
          outputs[field.name] = {
            type: typeMatch[1],
            description: description || `${field.name} output from the block`,
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

/**
 * Get the tool prefix (service name) from a tool name.
 * e.g., "calcom_list_schedules" -> "calcom"
 */
function getToolPrefixFromName(toolName: string): string {
  const parts = toolName.split('_')

  // Try to find a valid tool directory
  for (let i = parts.length - 1; i >= 1; i--) {
    const possiblePrefix = parts.slice(0, i).join('_')
    const toolDirPath = path.join(rootDir, `apps/sim/tools/${possiblePrefix}`)

    if (fs.existsSync(toolDirPath) && fs.statSync(toolDirPath).isDirectory()) {
      return possiblePrefix
    }
  }

  return parts[0]
}

/**
 * Resolve a const reference from a types file.
 * Handles nested const references recursively.
 *
 * @param constName - The const name to resolve (e.g., "SCHEDULE_DATA_OUTPUT_PROPERTIES")
 * @param toolPrefix - The tool prefix/service name (e.g., "calcom")
 * @param depth - Recursion depth to prevent infinite loops
 * @returns Resolved properties object or null if not found
 */
function resolveConstReference(
  constName: string,
  toolPrefix: string,
  depth = 0
): Record<string, any> | null {
  // Prevent infinite recursion
  if (depth > 10) {
    console.warn(`Max recursion depth reached resolving const: ${constName}`)
    return null
  }

  // Check cache first
  const cacheKey = `${toolPrefix}:${constName}`
  if (constResolutionCache.has(cacheKey)) {
    return constResolutionCache.get(cacheKey)!
  }

  // Read the types file for this tool
  const typesFilePath = path.join(rootDir, `apps/sim/tools/${toolPrefix}/types.ts`)
  if (!fs.existsSync(typesFilePath)) {
    // Try to find const in the tool file itself
    return null
  }

  const typesContent = fs.readFileSync(typesFilePath, 'utf-8')

  // Find the const definition
  // Pattern: export const CONST_NAME = { ... } as const
  const constRegex = new RegExp(
    `export\\s+const\\s+${constName}\\s*(?::\\s*[^=]+)?\\s*=\\s*\\{`,
    'g'
  )
  const constMatch = constRegex.exec(typesContent)

  if (!constMatch) {
    return null
  }

  // Extract the const content
  const startIndex = constMatch.index + constMatch[0].length - 1
  let braceCount = 1
  let endIndex = startIndex + 1

  while (endIndex < typesContent.length && braceCount > 0) {
    if (typesContent[endIndex] === '{') braceCount++
    else if (typesContent[endIndex] === '}') braceCount--
    endIndex++
  }

  if (braceCount !== 0) {
    return null
  }

  const constContent = typesContent.substring(startIndex + 1, endIndex - 1).trim()

  // Check if this const defines a complete output field (has type property)
  // like EVENT_TYPE_OUTPUT = { type: 'object', description: '...', properties: {...} }
  const typeMatch = constContent.match(/^\s*type\s*:\s*['"]([^'"]+)['"]/)
  if (typeMatch) {
    // This is a complete output definition - use parseConstFieldContent
    const result = parseConstFieldContent(constContent, toolPrefix, typesContent, depth + 1)
    if (result) {
      constResolutionCache.set(cacheKey, result)
    }
    return result
  }

  // Otherwise, this is a properties object - use parseConstProperties
  const properties = parseConstProperties(constContent, toolPrefix, typesContent, depth + 1)

  // Cache the result
  constResolutionCache.set(cacheKey, properties)

  return properties
}

/**
 * Parse properties from a const definition, resolving nested const references.
 */
function parseConstProperties(
  content: string,
  toolPrefix: string,
  typesContent: string,
  depth: number
): Record<string, any> {
  const properties: Record<string, any> = {}

  // First, handle spread operators (e.g., "...COMMENT_OUTPUT_PROPERTIES,")
  const spreadRegex = /\.\.\.([A-Z][A-Z_0-9]+)\s*(?:,|$)/g
  let spreadMatch
  while ((spreadMatch = spreadRegex.exec(content)) !== null) {
    const constName = spreadMatch[1]

    // Check if at depth 0
    const beforeMatch = content.substring(0, spreadMatch.index)
    const openBraces = (beforeMatch.match(/\{/g) || []).length
    const closeBraces = (beforeMatch.match(/\}/g) || []).length
    if (openBraces !== closeBraces) {
      continue
    }

    const resolvedConst = resolveConstFromTypesContent(constName, typesContent, toolPrefix, depth)
    if (resolvedConst && typeof resolvedConst === 'object') {
      // Spread all properties from the resolved const
      Object.assign(properties, resolvedConst)
    }
  }

  // Find all top-level property definitions
  const propRegex = /(\w+)\s*:\s*(?:\{|([A-Z][A-Z_0-9]+)(?:\s*,|\s*$))/g
  let match

  while ((match = propRegex.exec(content)) !== null) {
    const propName = match[1]
    const constRef = match[2]

    // Skip 'items' keyword (always a nested structure, never a field name)
    if (propName === 'items') {
      continue
    }

    // Check if this match is at depth 0 (not inside nested braces)
    const beforeMatch = content.substring(0, match.index)
    const openBraces = (beforeMatch.match(/\{/g) || []).length
    const closeBraces = (beforeMatch.match(/\}/g) || []).length
    if (openBraces !== closeBraces) {
      continue // Skip - this is a nested property
    }

    // For 'properties' or 'type', check if it's an output field definition vs a keyword
    // Output field definitions have 'type:' inside (e.g., { type: 'string', description: '...' })
    if ((propName === 'properties' || propName === 'type') && !constRef) {
      // Peek at what's inside the braces
      const startPos = match.index + match[0].length - 1
      let braceCount = 1
      let endPos = startPos + 1
      while (endPos < content.length && braceCount > 0) {
        if (content[endPos] === '{') braceCount++
        else if (content[endPos] === '}') braceCount--
        endPos++
      }
      if (braceCount === 0) {
        const propContent = content.substring(startPos + 1, endPos - 1).trim()
        // If it starts with 'type:', it's an output field definition - process it
        if (propContent.match(/^\s*type\s*:/)) {
          const parsedProp = parseConstFieldContent(propContent, toolPrefix, typesContent, depth)
          if (parsedProp) {
            properties[propName] = parsedProp
          }
        }
        // Otherwise, it's a keyword usage (nested properties block or type specifier) - skip it
      }
      continue
    }

    if (constRef) {
      // This property references a const (e.g., "attendees: ATTENDEES_OUTPUT")
      const resolvedConst = resolveConstFromTypesContent(constRef, typesContent, toolPrefix, depth)
      if (resolvedConst) {
        properties[propName] = resolvedConst
      }
    } else {
      // This property has inline definition
      const startPos = match.index + match[0].length - 1

      let braceCount = 1
      let endPos = startPos + 1

      while (endPos < content.length && braceCount > 0) {
        if (content[endPos] === '{') braceCount++
        else if (content[endPos] === '}') braceCount--
        endPos++
      }

      if (braceCount === 0) {
        const propContent = content.substring(startPos + 1, endPos - 1).trim()
        const parsedProp = parseConstFieldContent(propContent, toolPrefix, typesContent, depth)
        if (parsedProp) {
          properties[propName] = parsedProp
        }
      }
    }
  }

  return properties
}

/**
 * Resolve a const from the types content (for nested references within the same file).
 */
function resolveConstFromTypesContent(
  constName: string,
  typesContent: string,
  toolPrefix: string,
  depth: number
): Record<string, any> | null {
  if (depth > 10) return null

  // Check cache
  const cacheKey = `${toolPrefix}:${constName}`
  if (constResolutionCache.has(cacheKey)) {
    return constResolutionCache.get(cacheKey)!
  }

  // Find the const definition in typesContent
  const constRegex = new RegExp(
    `export\\s+const\\s+${constName}\\s*(?::\\s*[^=]+)?\\s*=\\s*\\{`,
    'g'
  )
  const constMatch = constRegex.exec(typesContent)

  if (!constMatch) {
    return null
  }

  const startIndex = constMatch.index + constMatch[0].length - 1
  let braceCount = 1
  let endIndex = startIndex + 1

  while (endIndex < typesContent.length && braceCount > 0) {
    if (typesContent[endIndex] === '{') braceCount++
    else if (typesContent[endIndex] === '}') braceCount--
    endIndex++
  }

  if (braceCount !== 0) return null

  const constContent = typesContent.substring(startIndex + 1, endIndex - 1).trim()

  // Check if this const defines a complete output field (has type property)
  const typeMatch = constContent.match(/^\s*type\s*:\s*['"]([^'"]+)['"]/)
  if (typeMatch) {
    // This is a complete output definition (like ATTENDEES_OUTPUT)
    const result = parseConstFieldContent(constContent, toolPrefix, typesContent, depth)
    if (result) {
      constResolutionCache.set(cacheKey, result)
    }
    return result
  }

  // This is a properties object (like ATTENDEE_OUTPUT_PROPERTIES)
  const properties = parseConstProperties(constContent, toolPrefix, typesContent, depth + 1)
  constResolutionCache.set(cacheKey, properties)
  return properties
}

/**
 * Parse a field content from a const, resolving nested const references.
 */
/**
 * Extract description from field content, handling quoted strings properly.
 * Handles single quotes, double quotes, and backticks, preserving internal quotes.
 */
function extractDescription(fieldContent: string): string | null {
  // Try single-quoted string (can contain double quotes)
  const singleQuoteMatch = fieldContent.match(/description\s*:\s*'([^']*)'/)
  if (singleQuoteMatch) return singleQuoteMatch[1]

  // Try double-quoted string (can contain single quotes)
  const doubleQuoteMatch = fieldContent.match(/description\s*:\s*"([^"]*)"/)
  if (doubleQuoteMatch) return doubleQuoteMatch[1]

  // Try backtick string
  const backtickMatch = fieldContent.match(/description\s*:\s*`([^`]*)`/)
  if (backtickMatch) return backtickMatch[1]

  return null
}

function parseConstFieldContent(
  fieldContent: string,
  toolPrefix: string,
  typesContent: string,
  depth: number
): any {
  const typeMatch = fieldContent.match(/type\s*:\s*['"]([^'"]+)['"]/)
  const description = extractDescription(fieldContent)

  if (!typeMatch) return null

  const fieldType = typeMatch[1]

  const result: any = {
    type: fieldType,
    description: description || '',
  }

  // Check for properties - either inline or const reference
  if (fieldType === 'object' || fieldType === 'json') {
    // Check for const reference first
    const propsConstMatch = fieldContent.match(/properties\s*:\s*([A-Z][A-Z_0-9]+)/)
    if (propsConstMatch) {
      const resolvedProps = resolveConstFromTypesContent(
        propsConstMatch[1],
        typesContent,
        toolPrefix,
        depth + 1
      )
      if (resolvedProps) {
        result.properties = resolvedProps
      }
    } else {
      // Check for inline properties
      const propertiesStart = fieldContent.search(/properties\s*:\s*\{/)
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
          result.properties = parseConstProperties(
            propertiesContent,
            toolPrefix,
            typesContent,
            depth + 1
          )
        }
      }
    }
  }

  // Check for items (arrays)
  const itemsConstMatch = fieldContent.match(/items\s*:\s*([A-Z][A-Z_0-9]+)/)
  if (itemsConstMatch) {
    const resolvedItems = resolveConstFromTypesContent(
      itemsConstMatch[1],
      typesContent,
      toolPrefix,
      depth + 1
    )
    if (resolvedItems) {
      result.items = resolvedItems
    }
  } else {
    const itemsStart = fieldContent.search(/items\s*:\s*\{/)
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
        const itemsDesc = extractDescription(itemsContent)

        result.items = {
          type: itemsType ? itemsType[1] : 'object',
          description: itemsDesc || '',
        }

        // Check for properties in items - either inline or const reference
        const itemsPropsConstMatch = itemsContent.match(/properties\s*:\s*([A-Z][A-Z_0-9]+)/)
        if (itemsPropsConstMatch) {
          const resolvedProps = resolveConstFromTypesContent(
            itemsPropsConstMatch[1],
            typesContent,
            toolPrefix,
            depth + 1
          )
          if (resolvedProps) {
            result.items.properties = resolvedProps
          }
        } else {
          const itemsPropsStart = itemsContent.search(/properties\s*:\s*\{/)
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
              result.items.properties = parseConstProperties(
                itemsPropsContent,
                toolPrefix,
                typesContent,
                depth + 1
              )
            }
          }
        }
      }
    }
  }

  return result
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

      /**
       * Checks if a position in the string is inside a quoted string.
       * This prevents matching patterns like "Example: {" inside description strings.
       */
      const isInsideString = (content: string, position: number): boolean => {
        let inSingleQuote = false
        let inDoubleQuote = false
        let inBacktick = false

        for (let i = 0; i < position; i++) {
          const char = content[i]
          const prevChar = i > 0 ? content[i - 1] : ''

          // Skip escaped quotes
          if (prevChar === '\\') continue

          if (char === "'" && !inDoubleQuote && !inBacktick) {
            inSingleQuote = !inSingleQuote
          } else if (char === '"' && !inSingleQuote && !inBacktick) {
            inDoubleQuote = !inDoubleQuote
          } else if (char === '`' && !inSingleQuote && !inDoubleQuote) {
            inBacktick = !inBacktick
          }
        }

        return inSingleQuote || inDoubleQuote || inBacktick
      }

      while ((paramMatch = paramBlocksRegex.exec(paramsContent)) !== null) {
        const paramName = paramMatch[1]
        const startPos = paramMatch.index + paramMatch[0].length - 1

        // Skip matches that are inside string literals (e.g., "Example: {" in descriptions)
        if (isInsideString(paramsContent, paramMatch.index)) {
          continue
        }

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

    // Get the tool prefix for resolving const references
    const toolPrefix = getToolPrefixFromName(toolName)

    let outputs: Record<string, any> = {}

    // Pattern 1: outputs directly assigned to a const (e.g., "outputs: GIT_REF_OUTPUT_PROPERTIES,")
    const directConstMatch = toolContent.match(
      /(?<![a-zA-Z_])outputs\s*:\s*([A-Z][A-Z_0-9]+)\s*(?:,|\}|$)/
    )
    if (directConstMatch) {
      const constName = directConstMatch[1]
      const resolvedConst = resolveConstReference(constName, toolPrefix)
      if (resolvedConst && typeof resolvedConst === 'object') {
        outputs = resolvedConst
      }
    }

    // Pattern 2: outputs is an object with properties (e.g., "outputs: { ... }")
    if (Object.keys(outputs).length === 0) {
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
            outputs = parseToolOutputsField(outputsContent, toolPrefix)
          }
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

    // Build prefix based on indent level - each level adds 2 spaces before the arrow
    let prefix = ''
    if (indentLevel > 0) {
      const spaces = '  '.repeat(indentLevel)
      prefix = `${spaces}↳ `
    }

    if (typeof output === 'object' && output !== null && output.type === 'array') {
      result += `| ${prefix}\`${key}\` | ${type} | ${escapedDescription} |\n`

      if (output.items?.properties) {
        const arrayItemsResult = formatOutputStructure(output.items.properties, indentLevel + 1)
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

function parseToolOutputsField(outputsContent: string, toolPrefix?: string): Record<string, any> {
  const outputs: Record<string, any> = {}

  // First, handle top-level const references
  // Patterns: "data: BOOKING_DATA_OUTPUT_PROPERTIES" or "pagination: PAGINATION_OUTPUT"
  if (toolPrefix) {
    // Pattern 1: Direct const reference
    const constRefRegex = /(\w+)\s*:\s*([A-Z][A-Z_0-9]+)\s*(?:,|$)/g
    let constMatch
    while ((constMatch = constRefRegex.exec(outputsContent)) !== null) {
      const propName = constMatch[1]
      const constName = constMatch[2]

      // Check if at depth 0
      const beforeMatch = outputsContent.substring(0, constMatch.index)
      const openBraces = (beforeMatch.match(/\{/g) || []).length
      const closeBraces = (beforeMatch.match(/\}/g) || []).length
      if (openBraces !== closeBraces) {
        continue
      }

      const resolvedConst = resolveConstReference(constName, toolPrefix)
      if (resolvedConst) {
        outputs[propName] = resolvedConst
      }
    }

    // Pattern 2: Property access on const (e.g., "status: BOOKING_DATA_OUTPUT_PROPERTIES.status,")
    const propAccessRegex = /(\w+)\s*:\s*([A-Z][A-Z_0-9]+)\.(\w+)\s*(?:,|$)/g
    let propAccessMatch
    while ((propAccessMatch = propAccessRegex.exec(outputsContent)) !== null) {
      const propName = propAccessMatch[1]
      const constName = propAccessMatch[2]
      const accessedProp = propAccessMatch[3]

      // Skip if already resolved
      if (outputs[propName]) {
        continue
      }

      // Check if at depth 0
      const beforeMatch = outputsContent.substring(0, propAccessMatch.index)
      const openBraces = (beforeMatch.match(/\{/g) || []).length
      const closeBraces = (beforeMatch.match(/\}/g) || []).length
      if (openBraces !== closeBraces) {
        continue
      }

      const resolvedConst = resolveConstReference(constName, toolPrefix)
      if (resolvedConst?.[accessedProp]) {
        outputs[propName] = resolvedConst[accessedProp]
      }
    }

    // Pattern 3: Spread operator (e.g., "...COMMENT_OUTPUT_PROPERTIES,")
    const spreadRegex = /\.\.\.([A-Z][A-Z_0-9]+)\s*(?:,|$)/g
    let spreadMatch
    while ((spreadMatch = spreadRegex.exec(outputsContent)) !== null) {
      const constName = spreadMatch[1]

      // Check if at depth 0 (not inside nested braces)
      const beforeMatch = outputsContent.substring(0, spreadMatch.index)
      const openBraces = (beforeMatch.match(/\{/g) || []).length
      const closeBraces = (beforeMatch.match(/\}/g) || []).length
      if (openBraces !== closeBraces) {
        continue
      }

      const resolvedConst = resolveConstReference(constName, toolPrefix)
      if (resolvedConst && typeof resolvedConst === 'object') {
        // Spread all properties from the resolved const
        Object.assign(outputs, resolvedConst)
      }
    }
  }

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

    // Skip if already resolved as const reference
    if (outputs[fieldName]) {
      continue
    }

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

    const parsedField = parseFieldContent(fieldContent, toolPrefix)
    if (parsedField) {
      outputs[field.name] = parsedField
    }
  })

  return outputs
}

function parseFieldContent(fieldContent: string, toolPrefix?: string): any {
  const typeMatch = fieldContent.match(/type\s*:\s*['"]([^'"]+)['"]/)
  const description = extractDescription(fieldContent)

  // Check for spread operator at the start of field content (e.g., ...SUBSCRIPTION_OUTPUT)
  // This pattern is used when a field spreads a complete output definition and optionally overrides properties
  const spreadMatch = fieldContent.match(/^\s*\.\.\.([A-Z][A-Z_0-9]+)\s*,/)
  if (spreadMatch && toolPrefix && !typeMatch) {
    const constName = spreadMatch[1]
    const resolvedConst = resolveConstReference(constName, toolPrefix)
    if (resolvedConst && typeof resolvedConst === 'object') {
      // Start with the resolved const and override with inline properties
      const result: any = { ...resolvedConst }
      // Override description if provided inline
      if (description) {
        result.description = description
      }
      return result
    }
  }

  if (!typeMatch) return null

  const fieldType = typeMatch[1]

  const result: any = {
    type: fieldType,
    description: description || '',
  }

  if (fieldType === 'object' || fieldType === 'json') {
    // Check for const reference first (e.g., properties: SCHEDULE_DATA_OUTPUT_PROPERTIES)
    const propsConstMatch = fieldContent.match(/properties\s*:\s*([A-Z][A-Z_0-9]+)/)
    if (propsConstMatch && toolPrefix) {
      const resolvedProps = resolveConstReference(propsConstMatch[1], toolPrefix)
      if (resolvedProps) {
        result.properties = resolvedProps
      }
    } else {
      // Check for inline properties
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
          result.properties = parsePropertiesContent(propertiesContent, toolPrefix)
        }
      }
    }
  }

  // Check for items const reference (e.g., items: ATTENDEES_OUTPUT)
  const itemsConstMatch = fieldContent.match(/items\s*:\s*([A-Z][A-Z_0-9]+)/)
  if (itemsConstMatch && toolPrefix) {
    const resolvedItems = resolveConstReference(itemsConstMatch[1], toolPrefix)
    if (resolvedItems) {
      result.items = resolvedItems
    }
  } else {
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

        // Check for inline properties FIRST (properties: {), then const reference
        const propertiesInlineStart = itemsContent.search(/properties\s*:\s*{/)
        // Only match const reference if it's at the TOP level (before any {)
        const itemsPropsConstMatch =
          propertiesInlineStart === -1
            ? itemsContent.match(/properties\s*:\s*([A-Z][A-Z_0-9]+)/)
            : null
        const searchContent =
          propertiesInlineStart >= 0
            ? itemsContent.substring(0, propertiesInlineStart)
            : itemsContent
        const itemsDesc = extractDescription(searchContent)

        result.items = {
          type: itemsType ? itemsType[1] : 'object',
          description: itemsDesc || '',
        }

        if (itemsPropsConstMatch && toolPrefix) {
          const resolvedProps = resolveConstReference(itemsPropsConstMatch[1], toolPrefix)
          if (resolvedProps) {
            result.items.properties = resolvedProps
          }
        } else if (propertiesInlineStart !== -1) {
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
              result.items.properties = parsePropertiesContent(itemsPropsContent, toolPrefix)
            }
          }
        }
      }
    }
  }

  return result
}

function parsePropertiesContent(
  propertiesContent: string,
  toolPrefix?: string
): Record<string, any> {
  const properties: Record<string, any> = {}

  // First, handle const references at the property level
  // Patterns: "attendees: ATTENDEES_OUTPUT" or "id: BOOKING_DATA_OUTPUT_PROPERTIES.id"
  if (toolPrefix) {
    // Pattern 1: Direct const reference (e.g., "eventType: EVENT_TYPE_OUTPUT,")
    const constRefRegex = /(\w+)\s*:\s*([A-Z][A-Z_0-9]+)\s*(?:,|$)/g
    let constMatch
    while ((constMatch = constRefRegex.exec(propertiesContent)) !== null) {
      const propName = constMatch[1]
      const constName = constMatch[2]

      // Skip keywords
      if (propName === 'items' || propName === 'properties' || propName === 'type') {
        continue
      }

      // Check if at depth 0
      const beforeMatch = propertiesContent.substring(0, constMatch.index)
      const openBraces = (beforeMatch.match(/\{/g) || []).length
      const closeBraces = (beforeMatch.match(/\}/g) || []).length
      if (openBraces !== closeBraces) {
        continue
      }

      const resolvedConst = resolveConstReference(constName, toolPrefix)
      if (resolvedConst) {
        properties[propName] = resolvedConst
      }
    }

    // Pattern 2: Property access on const (e.g., "id: BOOKING_DATA_OUTPUT_PROPERTIES.id,")
    const propAccessRegex = /(\w+)\s*:\s*([A-Z][A-Z_0-9]+)\.(\w+)\s*(?:,|$)/g
    let propAccessMatch
    while ((propAccessMatch = propAccessRegex.exec(propertiesContent)) !== null) {
      const propName = propAccessMatch[1]
      const constName = propAccessMatch[2]
      const accessedProp = propAccessMatch[3]

      // Skip keywords
      if (propName === 'items' || propName === 'properties' || propName === 'type') {
        continue
      }

      // Skip if already resolved
      if (properties[propName]) {
        continue
      }

      // Check if at depth 0
      const beforeMatch = propertiesContent.substring(0, propAccessMatch.index)
      const openBraces = (beforeMatch.match(/\{/g) || []).length
      const closeBraces = (beforeMatch.match(/\}/g) || []).length
      if (openBraces !== closeBraces) {
        continue
      }

      const resolvedConst = resolveConstReference(constName, toolPrefix)
      if (resolvedConst?.[accessedProp]) {
        properties[propName] = resolvedConst[accessedProp]
      }
    }

    // Pattern 3: Spread operator (e.g., "...COMMENT_OUTPUT_PROPERTIES,")
    const spreadRegex = /\.\.\.([A-Z][A-Z_0-9]+)\s*(?:,|$)/g
    let spreadMatch
    while ((spreadMatch = spreadRegex.exec(propertiesContent)) !== null) {
      const constName = spreadMatch[1]

      // Check if at depth 0
      const beforeMatch = propertiesContent.substring(0, spreadMatch.index)
      const openBraces = (beforeMatch.match(/\{/g) || []).length
      const closeBraces = (beforeMatch.match(/\}/g) || []).length
      if (openBraces !== closeBraces) {
        continue
      }

      const resolvedConst = resolveConstReference(constName, toolPrefix)
      if (resolvedConst && typeof resolvedConst === 'object') {
        // Spread all properties from the resolved const
        Object.assign(properties, resolvedConst)
      }
    }
  }

  const propStartRegex = /(\w+)\s*:\s*{/g
  let match
  const propPositions: Array<{ name: string; start: number; content: string }> = []

  while ((match = propStartRegex.exec(propertiesContent)) !== null) {
    const propName = match[1]

    if (propName === 'items' || propName === 'properties') {
      continue
    }

    // Skip if already resolved as const reference
    if (properties[propName]) {
      continue
    }

    // Check if this match is at depth 0 (not inside nested braces)
    // Only process top-level properties, skip nested ones
    const beforeMatch = propertiesContent.substring(0, match.index)
    const openBraces = (beforeMatch.match(/{/g) || []).length
    const closeBraces = (beforeMatch.match(/}/g) || []).length
    if (openBraces !== closeBraces) {
      continue // Skip - this is a nested property
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
      const hasProperties = /properties\s*:\s*[{A-Z]/.test(propContent)
      const hasItems = /items\s*:\s*[{A-Z]/.test(propContent)
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
    const parsedProp = parseFieldContent(prop.content, toolPrefix)
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
