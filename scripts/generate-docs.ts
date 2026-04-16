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
const LANDING_INTEGRATIONS_DATA_PATH = path.join(
  rootDir,
  'apps/sim/app/(landing)/integrations/data'
)
const TRIGGERS_PATH = path.join(rootDir, 'apps/sim/triggers')
const TRIGGER_DOCS_OUTPUT_PATH = path.join(rootDir, 'apps/docs/content/docs/en/triggers')

/** Trigger doc pages that are hand-written and must never be overwritten. */
const HANDWRITTEN_TRIGGER_DOCS = new Set(['index', 'start', 'schedule', 'webhook', 'rss'])

/** Providers whose docs are already covered by hand-written pages. */
const SKIP_TRIGGER_PROVIDERS = new Set(['generic', 'rss'])

/**
 * Maps trigger provider names (from TriggerConfig.provider) to their
 * corresponding block type when the two differ. Used to resolve icon
 * colours from the block registry.
 */
const PROVIDER_TO_BLOCK_TYPE: Record<string, string> = {
  'microsoft-teams': 'microsoft_teams',
  'google-calendar': 'google_calendar',
  'google-drive': 'google_drive',
  'google-sheets': 'google_sheets',
}

/** Human-readable display names for trigger providers. */
const TRIGGER_PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  airtable: 'Airtable',
  ashby: 'Ashby',
  attio: 'Attio',
  calcom: 'Cal.com',
  calendly: 'Calendly',
  circleback: 'Circleback',
  confluence: 'Confluence',
  fathom: 'Fathom',
  fireflies: 'Fireflies',
  github: 'GitHub',
  gmail: 'Gmail',
  gong: 'Gong',
  'google-calendar': 'Google Calendar',
  'google-drive': 'Google Drive',
  'google-sheets': 'Google Sheets',
  google_forms: 'Google Forms',
  grain: 'Grain',
  greenhouse: 'Greenhouse',
  hubspot: 'HubSpot',
  imap: 'IMAP',
  intercom: 'Intercom',
  jira: 'Jira',
  lemlist: 'Lemlist',
  linear: 'Linear',
  'microsoft-teams': 'Microsoft Teams',
  notion: 'Notion',
  outlook: 'Outlook',
  resend: 'Resend',
  salesforce: 'Salesforce',
  servicenow: 'ServiceNow',
  slack: 'Slack',
  stripe: 'Stripe',
  telegram: 'Telegram',
  twilio_voice: 'Twilio Voice',
  typeform: 'Typeform',
  vercel: 'Vercel',
  webflow: 'Webflow',
  whatsapp: 'WhatsApp',
  zoom: 'Zoom',
}

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
  operations?: OperationInfo[]
  docsLink?: string
  [key: string]: any
}

/**
 * Find the position after the matching close delimiter for an opening delimiter.
 * Assumes `content[openPos]` is the opening char (e.g. `{` or `[`).
 * Returns the index one past the matching close char, or -1 if unbalanced.
 */
function findMatchingClose(
  content: string,
  openPos: number,
  openChar = '{',
  closeChar = '}'
): number {
  let count = 1
  let pos = openPos + 1
  while (pos < content.length && count > 0) {
    if (content[pos] === openChar) count++
    else if (content[pos] === closeChar) count--
    pos++
  }
  return count === 0 ? pos : -1
}

interface TriggerInfo {
  id: string
  name: string
  description: string
}

interface TriggerConfigField {
  id: string
  title: string
  type: string
  required: boolean
  description?: string
  placeholder?: string
}

interface TriggerFullInfo {
  id: string
  name: string
  description: string
  provider: string
  polling: boolean
  outputs: Record<string, any>
  configFields: TriggerConfigField[]
}

interface OperationInfo {
  name: string
  description: string
}

interface IntegrationEntry {
  type: string
  slug: string
  name: string
  description: string
  longDescription: string
  bgColor: string
  iconName: string
  docsUrl: string
  operations: OperationInfo[]
  operationCount: number
  triggers: TriggerInfo[]
  triggerCount: number
  authType: 'oauth' | 'api-key' | 'none'
  category: string
  integrationTypes?: string[]
  tags?: string[]
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
      const primaryIcon = extractIconNameFromContent(fileContent)

      // Find all block exports and their types
      const exportRegex = /export\s+const\s+(\w+)Block\s*:\s*BlockConfig[^=]*=\s*\{/g
      let match

      while ((match = exportRegex.exec(fileContent)) !== null) {
        const blockName = match[1]
        const startIndex = match.index + match[0].length - 1

        // Extract the block content
        const endIndex = findMatchingClose(fileContent, startIndex)

        if (endIndex !== -1) {
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
/**
 * Sort strings to match Biome's organizeImports order:
 * case-insensitive character-by-character, uppercase before lowercase as tiebreaker.
 */
function biomeSortCompare(a: string, b: string): number {
  const minLen = Math.min(a.length, b.length)
  for (let i = 0; i < minLen; i++) {
    const al = a[i].toLowerCase()
    const bl = b[i].toLowerCase()
    if (al !== bl) return al < bl ? -1 : 1
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  }
  return a.length - b.length
}

function writeIconMapping(iconMapping: Record<string, string>): void {
  try {
    const iconMappingPath = path.join(rootDir, 'apps/docs/components/ui/icon-mapping.ts')

    // Add bare-name aliases for versioned block types so trigger provider names resolve correctly.
    // e.g. github_v2 → github, fireflies_v2 → fireflies, gmail_v2 → gmail
    const withAliases: Record<string, string> = { ...iconMapping }
    for (const [blockType, iconName] of Object.entries(iconMapping)) {
      const baseType = stripVersionSuffix(blockType)
      if (baseType !== blockType && !withAliases[baseType]) {
        withAliases[baseType] = iconName
      }
    }

    // Get unique icon names, sorted to match Biome's organizeImports
    const iconNames = [...new Set(Object.values(withAliases))].sort(biomeSortCompare)

    // Generate imports
    const imports = iconNames.map((icon) => `  ${icon},`).join('\n')

    // Generate mapping with direct references (no dynamic access for tree shaking)
    const mappingEntries = Object.entries(withAliases)
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
 * Extract operation options from the subBlock with id: 'operation' (if present).
 * Returns { label, id } pairs — label is the display name, id is the option's id field
 * (used to construct the tool ID as `{blockType}_{id}`).
 * Parses the subBlocks array using brace/bracket counting to safely traverse
 * the nested structure without eval or a full AST parser.
 */
function extractOperationsFromContent(blockContent: string): { label: string; id: string }[] {
  const subBlocksMatch = /subBlocks\s*:\s*\[/.exec(blockContent)
  if (!subBlocksMatch) return []

  // Locate the opening '[' of the subBlocks array
  const arrayStart = subBlocksMatch.index + subBlocksMatch[0].length - 1
  const arrayEnd = findMatchingClose(blockContent, arrayStart, '[', ']')
  if (arrayEnd === -1) return []
  const subBlocksContent = blockContent.substring(arrayStart + 1, arrayEnd - 1)

  // Iterate over top-level objects in the subBlocks array, looking for id: 'operation'
  let i = 0
  while (i < subBlocksContent.length) {
    if (subBlocksContent[i] === '{') {
      const j = findMatchingClose(subBlocksContent, i)
      if (j === -1) break
      const objContent = subBlocksContent.substring(i, j)

      if (/\bid\s*:\s*['"]operation['"]/.test(objContent)) {
        const optionsMatch = /options\s*:\s*\[/.exec(objContent)
        if (!optionsMatch) return []

        const optArrayStart = optionsMatch.index + optionsMatch[0].length - 1
        const optArrayEnd = findMatchingClose(objContent, optArrayStart, '[', ']')
        if (optArrayEnd === -1) return []
        const optionsContent = objContent.substring(optArrayStart + 1, optArrayEnd - 1)

        // Extract { label, id } pairs from each option object
        const pairs: { label: string; id: string }[] = []
        const optionObjectRegex = /\{[^{}]*\}/g
        let m
        while ((m = optionObjectRegex.exec(optionsContent)) !== null) {
          const optObj = m[0]
          const labelMatch = /label\s*:\s*['"]([^'"]+)['"]/.exec(optObj)
          const idMatch = /\bid\s*:\s*['"]([^'"]+)['"]/.exec(optObj)
          if (labelMatch) {
            pairs.push({ label: labelMatch[1], id: idMatch ? idMatch[1] : '' })
          }
        }
        return pairs
      }
      i = j
    } else {
      i++
    }
  }
  return []
}

/**
 * Extract a mapping from operation id → tool id by scanning switch/case/return
 * patterns in a block file. Handles both simple returns and ternary returns
 * (for ternaries, takes the last quoted tool-like string, which is typically
 * the default/list variant). Also picks up named helper functions referenced
 * from tools.config.tool (e.g. selectGmailToolId).
 */
function extractSwitchCaseToolMapping(fileContent: string): Map<string, string> {
  const mapping = new Map<string, string>()
  const caseRegex = /\bcase\s+['"]([^'"]+)['"]\s*:/g
  let caseMatch: RegExpExecArray | null

  while ((caseMatch = caseRegex.exec(fileContent)) !== null) {
    const opId = caseMatch[1]
    if (mapping.has(opId)) continue

    const searchStart = caseMatch.index + caseMatch[0].length
    const searchEnd = Math.min(searchStart + 300, fileContent.length)
    const segment = fileContent.substring(searchStart, searchEnd)

    const returnIdx = segment.search(/\breturn\b/)
    if (returnIdx === -1) continue

    const afterReturn = segment.substring(returnIdx + 'return'.length)
    // Limit scope to before the next case/default to avoid capturing sibling cases
    const nextCaseIdx = afterReturn.search(/\bcase\b|\bdefault\b/)
    const returnScope = nextCaseIdx > 0 ? afterReturn.substring(0, nextCaseIdx) : afterReturn

    const toolMatches = [...returnScope.matchAll(/['"]([a-z][a-z0-9_]+)['"]/g)]
    // Take the last tool-like string (underscore = tool ID pattern); for ternaries this
    // is the fallback/list variant
    const toolId = toolMatches
      .map((m) => m[1])
      .filter((id) => id.includes('_'))
      .pop()
    if (toolId) {
      mapping.set(opId, toolId)
    }
  }

  return mapping
}

/**
 * Scan all tool files under apps/sim/tools/ and build a map from tool ID to description.
 * Used to enrich operation entries with descriptions.
 */
interface ToolMaps {
  desc: Map<string, string>
  name: Map<string, string>
}

async function buildToolDescriptionMap(): Promise<ToolMaps> {
  const toolsDir = path.join(rootDir, 'apps/sim/tools')
  const desc = new Map<string, string>()
  const name = new Map<string, string>()
  try {
    const toolFiles = await glob(`${toolsDir}/**/*.ts`)
    for (const file of toolFiles) {
      const basename = path.basename(file)
      if (basename === 'index.ts' || basename === 'types.ts') continue
      const content = fs.readFileSync(file, 'utf-8')

      // Find every `id: 'tool_id'` occurrence in the file. For each, search
      // the next ~600 characters for `name:` and `description:` fields, cutting
      // off at the first `params:` block within that window. This handles both
      // the simple inline pattern (id → description → params in one object) and
      // the two-step pattern (base object holds params, ToolConfig export holds
      // id + description after the base object).
      const idRegex = /\bid\s*:\s*['"]([^'"]+)['"]/g
      let idMatch: RegExpExecArray | null
      while ((idMatch = idRegex.exec(content)) !== null) {
        const toolId = idMatch[1]
        if (desc.has(toolId)) continue
        const windowStart = idMatch.index
        const windowEnd = Math.min(windowStart + 600, content.length)
        const window = content.substring(windowStart, windowEnd)
        // Stop before any params block so we don't pick up param-level values
        const paramsOffset = window.search(/\bparams\s*:\s*\{/)
        const searchWindow = paramsOffset > 0 ? window.substring(0, paramsOffset) : window
        const descMatch = searchWindow.match(/\bdescription\s*:\s*['"]([^'"]{5,})['"]/)
        const nameMatch = searchWindow.match(/\bname\s*:\s*['"]([^'"]+)['"]/)
        if (descMatch) desc.set(toolId, descMatch[1])
        if (nameMatch) name.set(toolId, nameMatch[1])
      }
    }
  } catch {
    // Non-fatal: descriptions will be empty strings
  }
  return { desc, name }
}

/**
 * Detect the authentication type from block content.
 * Returns 'oauth' if the block uses oauth-input credentials,
 * 'api-key' if it uses a plain API key field, or 'none' otherwise.
 */
function extractAuthType(blockContent: string): 'oauth' | 'api-key' | 'none' {
  if (/type\s*:\s*['"]oauth-input['"]/.test(blockContent)) return 'oauth'
  if (/\bid\s*:\s*['"](?:apiKey|api_key|accessToken)['"]/.test(blockContent)) return 'api-key'
  return 'none'
}

/**
 * Extract the list of trigger IDs from the block's `triggers.available` array.
 * Handles blocks that declare `triggers: { enabled: true, available: [...] }`.
 */
function extractTriggersAvailable(blockContent: string): string[] {
  const triggersMatch = /\btriggers\s*:\s*\{/.exec(blockContent)
  if (!triggersMatch) return []

  const start = triggersMatch.index + triggersMatch[0].length - 1
  const trigEnd = findMatchingClose(blockContent, start)
  if (trigEnd === -1) return []
  const triggersContent = blockContent.substring(start, trigEnd)

  if (!/enabled\s*:\s*true/.test(triggersContent)) return []

  const availableMatch = /available\s*:\s*\[/.exec(triggersContent)
  if (!availableMatch) return []

  const arrayStart = availableMatch.index + availableMatch[0].length - 1
  const arrayEnd = findMatchingClose(triggersContent, arrayStart, '[', ']')
  if (arrayEnd === -1) return []
  const arrayContent = triggersContent.substring(arrayStart + 1, arrayEnd - 1)

  const ids: string[] = []
  const idRegex = /['"]([^'"]+)['"]/g
  let m
  while ((m = idRegex.exec(arrayContent)) !== null) {
    ids.push(m[1])
  }
  return ids
}

/**
 * Scan all trigger definition files and build a registry mapping trigger IDs
 * to their human-readable name and description.
 */
async function buildTriggerRegistry(): Promise<Map<string, TriggerInfo>> {
  const registry = new Map<string, TriggerInfo>()
  const SKIP = new Set(['index.ts', 'registry.ts', 'types.ts', 'constants.ts', 'utils.ts'])

  const triggerFiles = (await glob(`${TRIGGERS_PATH}/**/*.ts`)).filter(
    (f) => !SKIP.has(path.basename(f)) && !f.includes('.test.')
  )

  for (const file of triggerFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8')

      // A file may export multiple TriggerConfig objects (e.g. v1 + v2 in
      // the same file). Extract all exported configs by splitting on the
      // export boundaries and parsing each one independently.
      const exportRegex = /export\s+const\s+\w+\s*:\s*TriggerConfig\s*=\s*\{/g
      let exportMatch
      const exportStarts: number[] = []

      while ((exportMatch = exportRegex.exec(content)) !== null) {
        exportStarts.push(exportMatch.index)
      }

      // If no typed exports found, fall back to simple regex on whole file
      const segments =
        exportStarts.length > 0
          ? exportStarts.map((start, i) => content.substring(start, exportStarts[i + 1]))
          : [content]

      for (const segment of segments) {
        const idMatch = /\bid\s*:\s*['"]([^'"]+)['"]/.exec(segment)
        const nameMatch = /\bname\s*:\s*['"]([^'"]+)['"]/.exec(segment)
        const descMatch = /\bdescription\s*:\s*['"]([^'"]+)['"]/.exec(segment)

        if (idMatch && nameMatch) {
          registry.set(idMatch[1], {
            id: idMatch[1],
            name: nameMatch[1],
            description: descMatch?.[1] ?? '',
          })
        }
      }
    } catch {
      // skip unreadable files silently
    }
  }

  console.log(`✓ Loaded ${registry.size} trigger definitions`)
  return registry
}

/**
 * Write the icon mapping TypeScript file for the landing integrations page.
 * Mirrors writeIconMapping but targets the sim app so it imports from @/components/icons.
 */
function writeIntegrationsIconMapping(iconMapping: Record<string, string>): void {
  try {
    if (!fs.existsSync(LANDING_INTEGRATIONS_DATA_PATH)) {
      fs.mkdirSync(LANDING_INTEGRATIONS_DATA_PATH, { recursive: true })
    }
    const iconMappingPath = path.join(LANDING_INTEGRATIONS_DATA_PATH, 'icon-mapping.ts')

    const iconNames = [...new Set(Object.values(iconMapping))].sort(biomeSortCompare)
    const imports = iconNames.map((icon) => `  ${icon},`).join('\n')
    const mappingEntries = Object.entries(iconMapping)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([blockType, iconName]) => `  ${blockType}: ${iconName},`)
      .join('\n')

    const content = `// Auto-generated file - do not edit manually
// Generated by scripts/generate-docs.ts
// Maps block types to their icon component references for the integrations page

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
    console.log('✓ Integration icon mapping written to landing app')
  } catch (error) {
    console.error('Error writing integration icon mapping:', error)
  }
}

/**
 * Collect all integration entries from block definitions and write integrations.json
 * to the landing integrations page data directory.
 * Applies the same visibility filters as the docs generation pipeline.
 */
async function writeIntegrationsJson(iconMapping: Record<string, string>): Promise<void> {
  try {
    if (!fs.existsSync(LANDING_INTEGRATIONS_DATA_PATH)) {
      fs.mkdirSync(LANDING_INTEGRATIONS_DATA_PATH, { recursive: true })
    }

    const triggerRegistry = await buildTriggerRegistry()
    const { desc: toolDescMap, name: toolNameMap } = await buildToolDescriptionMap()
    const integrations: IntegrationEntry[] = []
    const seenBaseTypes = new Set<string>()
    const blockFiles = (await glob(`${BLOCKS_PATH}/*.ts`)).sort()

    for (const blockFile of blockFiles) {
      const fileContent = fs.readFileSync(blockFile, 'utf-8')
      const switchCaseMap = extractSwitchCaseToolMapping(fileContent)
      const configs = extractAllBlockConfigs(fileContent)

      for (const config of configs) {
        const blockType = config.type

        // Apply the same filters as docs/icon-mapping generation
        if (
          blockType.includes('_trigger') ||
          blockType.includes('_webhook') ||
          blockType.includes('rss') ||
          (config.category === 'blocks' && blockType !== 'memory' && blockType !== 'knowledge') ||
          blockType === 'evaluator' ||
          blockType === 'number' ||
          blockType === 'webhook' ||
          blockType === 'schedule' ||
          blockType === 'mcp' ||
          blockType === 'generic_webhook'
        ) {
          continue
        }

        // Deduplicate by stripped base type
        const baseType = stripVersionSuffix(blockType)
        if (seenBaseTypes.has(baseType)) continue
        seenBaseTypes.add(baseType)

        const iconName = (config as any).iconName || iconMapping[blockType] || ''
        const rawOps: { label: string; id: string }[] = (config as any).operations || []

        // Enrich each operation with a description from the tool registry.
        // Lookup order:
        // 1. Derive toolId as `{baseType}_{operationId}` and check directly.
        // 2. Check switch/case mapping parsed from tools.config.tool (handles
        //    cases where op IDs differ from tool IDs, e.g. get_carts → list_carts,
        //    or send_gmail → gmail_send).
        // 3. Find the tool in tools.access whose name exactly matches the label.
        const toolsAccess: string[] = (config as any).tools?.access || []
        const operations: OperationInfo[] = rawOps.map(({ label, id }) => {
          const toolId = `${baseType}_${id}`
          let opDesc = toolDescMap.get(toolId) || toolDescMap.get(id) || ''

          if (!opDesc) {
            const switchMappedId = switchCaseMap.get(id)
            if (switchMappedId) {
              opDesc = toolDescMap.get(switchMappedId) || ''
              // Also check versioned variants in tools.access (e.g. gmail_send_v2)
              if (!opDesc) {
                for (const tId of toolsAccess) {
                  if (tId === switchMappedId || tId.startsWith(`${switchMappedId}_v`)) {
                    opDesc = toolDescMap.get(tId) || ''
                    if (opDesc) break
                  }
                }
              }
            }
          }

          if (!opDesc && toolsAccess.length > 0) {
            for (const tId of toolsAccess) {
              if (toolNameMap.get(tId)?.toLowerCase() === label.toLowerCase()) {
                opDesc = toolDescMap.get(tId) || ''
                if (opDesc) break
              }
            }
          }

          return { name: label, description: opDesc }
        })

        const triggerIds: string[] = (config as any).triggerIds || []
        const triggers: TriggerInfo[] = triggerIds
          .map((id) => triggerRegistry.get(id))
          .filter((t): t is TriggerInfo => t !== undefined)
        const docsUrl = (config as any).docsLink || `https://docs.sim.ai/tools/${baseType}`

        const slug = config.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')

        const authType = extractAuthType(fileContent)

        integrations.push({
          type: blockType,
          slug,
          name: config.name,
          description: config.description,
          longDescription: config.longDescription || '',
          bgColor: config.bgColor || '#6B7280',
          iconName,
          docsUrl,
          operations,
          operationCount: operations.length,
          triggers,
          triggerCount: triggers.length,
          authType,
          category: config.category,
          ...(config.integrationType || config.tags
            ? {
                integrationTypes: deriveIntegrationTypes(
                  config.integrationType || null,
                  config.tags || []
                ),
              }
            : {}),
          ...(config.tags ? { tags: config.tags } : {}),
        })
      }
    }

    // Sort alphabetically by name for a predictable, crawl-friendly order
    integrations.sort((a, b) => a.name.localeCompare(b.name))

    const jsonPath = path.join(LANDING_INTEGRATIONS_DATA_PATH, 'integrations.json')
    // JSON.stringify always expands arrays across multiple lines. Biome's formatter
    // collapses short arrays of primitives onto single lines. Post-process to match.
    const json = JSON.stringify(integrations, null, 2).replace(
      /\[\n(\s+"[^"\n]*"(?:,\n\s+"[^"\n]*")*)\n\s+\]/g,
      (_match, inner) => {
        const items = (inner as string).split(',\n').map((s: string) => s.trim())
        return `[${items.join(', ')}]`
      }
    )
    fs.writeFileSync(jsonPath, `${json}\n`)
    console.log(`✓ Integration data written: ${integrations.length} integrations → ${jsonPath}`)
  } catch (error) {
    console.error('Error writing integrations JSON:', error)
  }
}

/**
 * Extract ALL block configs from a file, filtering out hidden blocks
 */
function extractAllBlockConfigs(fileContent: string): BlockConfig[] {
  const configs: BlockConfig[] = []

  // First, extract the primary icon from the file (for V2 blocks that inherit via spread)
  const primaryIcon = extractIconNameFromContent(fileContent)

  // Find all block exports in the file
  const exportRegex = /export\s+const\s+(\w+)Block\s*:\s*BlockConfig[^=]*=\s*\{/g
  let match

  while ((match = exportRegex.exec(fileContent)) !== null) {
    const blockName = match[1]
    const startIndex = match.index + match[0].length - 1 // Position of opening brace

    // Extract the block content by matching braces
    const endIndex = findMatchingClose(fileContent, startIndex)

    if (endIndex !== -1) {
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
        const endIndex = findMatchingClose(fileContent, startIndex)

        if (endIndex !== -1) {
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

    const operations = extractOperationsFromContent(blockContent)
    const triggerIds = extractTriggersAvailable(blockContent)
    const docsLink =
      extractStringPropertyFromContent(blockContent, 'docsLink', true) ||
      baseConfig?.docsLink ||
      `https://docs.sim.ai/tools/${stripVersionSuffix(blockType)}`

    const integrationType =
      extractEnumPropertyFromContent(blockContent, 'integrationType') ||
      baseConfig?.integrationType ||
      null
    const tags = extractArrayPropertyFromContent(blockContent, 'tags') || baseConfig?.tags || null

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
      operations: operations.length > 0 ? operations : (baseConfig as any)?.operations || [],
      triggerIds: triggerIds.length > 0 ? triggerIds : (baseConfig as any)?.triggerIds || [],
      docsLink,
      ...(integrationType ? { integrationType } : {}),
      ...(tags ? { tags } : {}),
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

/**
 * Tag-to-category mapping used by deriveIntegrationTypes to expand a block's
 * primary integrationType into a full set of categories for the landing page.
 */
const TAG_TO_CATEGORIES: Record<string, string[]> = {
  llm: ['ai'],
  agentic: ['ai'],
  'image-generation': ['ai', 'design'],
  'video-generation': ['ai', 'design'],
  'text-to-speech': ['ai'],
  'speech-to-text': ['ai'],
  ocr: ['ai', 'documents'],
  'vector-search': ['ai', 'search'],
  'document-processing': ['documents'],
  'content-management': ['documents'],
  'e-signatures': ['documents'],
  'note-taking': ['productivity', 'documents'],
  'knowledge-base': ['documents', 'search'],
  'data-analytics': ['analytics'],
  seo: ['analytics', 'search'],
  monitoring: ['developer-tools', 'analytics'],
  'error-tracking': ['developer-tools'],
  'incident-management': ['developer-tools'],
  'version-control': ['developer-tools'],
  'ci-cd': ['developer-tools'],
  'feature-flags': ['developer-tools'],
  messaging: ['communication'],
  meeting: ['communication', 'productivity'],
  calendar: ['productivity'],
  scheduling: ['productivity'],
  'project-management': ['productivity'],
  ticketing: ['productivity', 'customer-support'],
  forms: ['productivity'],
  spreadsheet: ['productivity', 'databases'],
  'data-warehouse': ['databases'],
  cloud: ['developer-tools'],
  'web-scraping': ['search'],
  'sales-engagement': ['sales'],
  enrichment: ['sales'],
  'email-marketing': ['email'],
  marketing: ['analytics'],
  payments: ['ecommerce'],
  subscriptions: ['ecommerce'],
  hiring: ['hr'],
  identity: ['security'],
  'secrets-management': ['security'],
  'customer-support': ['customer-support'],
  webhooks: ['developer-tools'],
  automation: ['developer-tools'],
}

/**
 * Derive the full list of integration type categories from a block's primary
 * integrationType and its tags. The primary type is always first; additional
 * categories are inferred from tags via TAG_TO_CATEGORIES.
 */
function deriveIntegrationTypes(primaryType: string | null, tags: string[]): string[] {
  const types = new Set<string>()
  if (primaryType) {
    types.add(primaryType)
  }
  for (const tag of tags) {
    const mapped = TAG_TO_CATEGORIES[tag]
    if (mapped) {
      for (const t of mapped) {
        types.add(t)
      }
    }
  }
  // Return primary first, then the rest sorted for deterministic output
  const result: string[] = []
  if (primaryType && types.has(primaryType)) {
    result.push(primaryType)
    types.delete(primaryType)
  }
  result.push(...Array.from(types).sort())
  return result
}

/**
 * Extract an enum property value from block content.
 * Matches patterns like `integrationType: IntegrationType.DeveloperTools`
 * and returns the string value (e.g., 'developer-tools').
 */
function extractEnumPropertyFromContent(content: string, propName: string): string | null {
  const match = content.match(new RegExp(`${propName}\\s*:\\s*IntegrationType\\.(\\w+)`))
  if (!match) return null
  const enumKey = match[1]
  // Convert enum key to kebab-case value (e.g., DeveloperTools -> developer-tools)
  const ENUM_MAP: Record<string, string> = {
    AI: 'ai',
    Analytics: 'analytics',
    Communication: 'communication',
    CRM: 'crm',
    CustomerSupport: 'customer-support',
    Databases: 'databases',
    Design: 'design',
    DeveloperTools: 'developer-tools',
    Documents: 'documents',
    Ecommerce: 'ecommerce',
    Email: 'email',
    FileStorage: 'file-storage',
    HR: 'hr',
    Other: 'other',
    Productivity: 'productivity',
    Sales: 'sales',
    Search: 'search',
    Security: 'security',
  }
  return ENUM_MAP[enumKey] || enumKey.toLowerCase()
}

/**
 * Extract a string array property from block content.
 * Matches patterns like `tags: ['api', 'oauth', 'webhooks']`
 */
function extractArrayPropertyFromContent(content: string, propName: string): string[] | null {
  const match = content.match(new RegExp(`${propName}\\s*:\\s*\\[([^\\]]+)\\]`))
  if (!match) return null
  const items = match[1].match(/'([^']+)'|"([^"]+)"/g)
  if (!items) return null
  return items.map((item) => item.replace(/['"]/g, ''))
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

  const pos = findMatchingClose(content, openBracePos)
  if (pos === -1) return {}

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
    const endPos = findMatchingClose(outputsContent, field.start)

    if (endPos !== -1) {
      const fieldContent = outputsContent.substring(field.start + 1, endPos - 1).trim()

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

  return outputs
}

function extractToolsAccessFromContent(content: string): string[] {
  const accessMatch = content.match(/access\s*:\s*\[\s*([^\]]+)\s*\]/)
  if (!accessMatch) return []
  return [...accessMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])
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
  const endIndex = findMatchingClose(typesContent, startIndex)

  if (endIndex === -1) {
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
      const endPos = findMatchingClose(content, startPos)
      if (endPos !== -1) {
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
      const endPos = findMatchingClose(content, startPos)

      if (endPos !== -1) {
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
  const endIndex = findMatchingClose(typesContent, startIndex)

  if (endIndex === -1) return null

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
  // Walk through all `description:` matches and return the first one at depth 0.
  // This prevents accidentally picking up `description:` keys inside nested child objects.
  const descRegex = /description\s*:\s*('([^']*)'|"([^"]*)"|`([^`]*)`)/g
  let m: RegExpExecArray | null
  while ((m = descRegex.exec(fieldContent)) !== null) {
    if (isAtDepthZero(fieldContent, m.index)) {
      return m[2] ?? m[3] ?? m[4] ?? null
    }
  }
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
        const braceEnd = findMatchingClose(fieldContent, braceStart)

        if (braceEnd !== -1) {
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
      const braceEnd = findMatchingClose(fieldContent, braceStart)

      if (braceEnd !== -1) {
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

/**
 * Extract outputs from a tool content block by trying:
 * 1. Const reference (e.g., `outputs: GIT_REF_OUTPUT_PROPERTIES,`)
 * 2. Inline object (e.g., `outputs: { id: { type: 'string', ... } }`)
 */
function extractOutputsFromToolContent(content: string, toolPrefix: string): Record<string, any> {
  const constMatch = content.match(/(?<![a-zA-Z_])outputs\s*:\s*([A-Z][A-Z_0-9]+)\s*(?:,|\}|$)/)
  if (constMatch) {
    const resolved = resolveConstReference(constMatch[1], toolPrefix)
    if (resolved && typeof resolved === 'object') {
      return resolved
    }
  }

  const outputsStart = content.search(/(?<![a-zA-Z_])outputs\s*:\s*{/)
  if (outputsStart !== -1) {
    const openBracePos = content.indexOf('{', outputsStart)
    if (openBracePos !== -1) {
      const closePos = findMatchingClose(content, openBracePos)
      if (closePos !== -1) {
        const outputsContent = content.substring(openBracePos + 1, closePos - 1).trim()
        return parseToolOutputsField(outputsContent, toolPrefix)
      }
    }
  }

  return {}
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
        const endIndex = findMatchingClose(fileContent, startIndex)

        if (endIndex !== -1) {
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

        const endPos = findMatchingClose(paramsContent, startPos)

        if (endPos !== -1) {
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

    let outputs = extractOutputsFromToolContent(toolContent, toolPrefix)

    // If no outputs found, check for spread inheritance (e.g., "...extendParserTool")
    // toolContent may be narrowed past the spread line, so reconstruct the full block
    if (Object.keys(outputs).length === 0) {
      let fullToolBlock = toolContent
      if (toolIdMatch && toolIdMatch.index !== undefined) {
        const beforeId = fileContent.substring(0, toolIdMatch.index)
        const exportRegex = /export\s+const\s+\w+[^=]*=\s*\{/g
        let lastExportMatch: RegExpExecArray | null = null
        let m: RegExpExecArray | null = null
        while ((m = exportRegex.exec(beforeId)) !== null) {
          lastExportMatch = m
        }
        if (lastExportMatch && lastExportMatch.index !== undefined) {
          const bracePos = lastExportMatch.index + lastExportMatch[0].length - 1
          const ep = findMatchingClose(fileContent, bracePos)
          if (ep !== -1) {
            fullToolBlock = fileContent.substring(bracePos, ep)
          }
        }
      }
      const spreadMatch = fullToolBlock.match(/\.\.\.(\w+(?:Tool|Base)\w*)/)
      if (spreadMatch) {
        const baseVarName = spreadMatch[1]
        const baseToolRegex = new RegExp(
          `export\\s+const\\s+${baseVarName}(?=[^a-zA-Z0-9_]|$)[^=]*=\\s*\\{`
        )
        const baseToolMatch = fileContent.match(baseToolRegex)
        if (baseToolMatch && baseToolMatch.index !== undefined) {
          const baseStart = baseToolMatch.index + baseToolMatch[0].length - 1
          const endIdx = findMatchingClose(fileContent, baseStart)
          if (endIdx !== -1) {
            const baseToolContent = fileContent.substring(baseStart, endIdx)
            outputs = extractOutputsFromToolContent(baseToolContent, toolPrefix)
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
      const endPos = findMatchingClose(outputsContent, bracePos)
      if (endPos !== -1) {
        fieldPositions.push({
          name: fieldName,
          start: bracePos,
          end: endPos,
          level: openBrace.level,
        })
      }
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

/**
 * Returns true if the regex match at `matchIndex` within `content` is at brace depth 0.
 * Used to distinguish top-level keys from keys nested inside child objects.
 */
function isAtDepthZero(content: string, matchIndex: number): boolean {
  let depth = 0
  for (let i = 0; i < matchIndex; i++) {
    if (content[i] === '{') depth++
    else if (content[i] === '}') depth--
  }
  return depth === 0
}

function parseFieldContent(fieldContent: string, toolPrefix?: string): any {
  // Only match `type:` that is at the top level of fieldContent (depth 0).
  // Child objects like `title: { type: 'string', ... }` also contain `type:` but at depth 1.
  const typeRegex = /type\s*:\s*['"]([^'"]+)['"]/g
  let typeMatch: RegExpExecArray | null = null
  let m: RegExpExecArray | null
  while ((m = typeRegex.exec(fieldContent)) !== null) {
    if (isAtDepthZero(fieldContent, m.index)) {
      typeMatch = m
      break
    }
  }
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

  if (!typeMatch) {
    // No top-level `type` key — check if the content contains named child fields that each
    // have their own `type` property. This is the "implicit object" pattern used in trigger
    // outputs (e.g., Cal.com's `payload`, Linear's `data`).
    const properties = parsePropertiesContent(fieldContent, toolPrefix)
    if (Object.keys(properties).length > 0) {
      return {
        type: 'object',
        description: description || '',
        properties,
      }
    }
    return null
  }

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
        const braceEnd = findMatchingClose(fieldContent, braceStart)

        if (braceEnd !== -1) {
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
      const braceEnd = findMatchingClose(fieldContent, braceStart)

      if (braceEnd !== -1) {
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

    const endPos = findMatchingClose(propertiesContent, startPos)

    if (endPos !== -1) {
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
      const endIndex = findMatchingClose(fileContent, startIndex)

      if (endIndex !== -1) {
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

// ============================================================================
// Trigger Documentation Generation
// ============================================================================

/**
 * Format a trigger provider name for display, falling back to Title Case.
 */
function formatTriggerProviderName(provider: string): string {
  if (TRIGGER_PROVIDER_DISPLAY_NAMES[provider]) {
    return TRIGGER_PROVIDER_DISPLAY_NAMES[provider]
  }
  return provider.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Escape text for use inside an MDX table cell.
 */
function escapeMdxCell(text: string): string {
  return text
    .replace(/\|/g, '\\|')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Resolve a module-level `const varName = { ... }` declaration.
 * Handles nested spreads of other const variables (but not property-access values).
 * Used to expand variable spreads inside builder function return bodies.
 */
function resolveConstVariable(
  varName: string,
  primaryContent: string,
  utilsContent: string,
  depth = 0
): Record<string, any> {
  if (depth > 8) return {}

  // Match `const varName = {` (with optional type annotation)
  const varRegex = new RegExp(`(?<![.\\w])const\\s+${varName}\\s*(?::[^=]+)?=\\s*\\{`)

  for (const content of [primaryContent, utilsContent]) {
    const varMatch = varRegex.exec(content)
    if (!varMatch) continue

    const openBrace = content.indexOf('{', varMatch.index + varMatch[0].length - 1)
    if (openBrace === -1) continue

    const closeBrace = findMatchingClose(content, openBrace)
    if (closeBrace === -1) continue

    const varBody = content.substring(openBrace + 1, closeBrace - 1).trim()
    const result: Record<string, any> = {}

    // Resolve nested variable spreads within this const (no parens = variable reference)
    const nestedSpreadRegex = /\.\.\.\s*([a-zA-Z_]\w*)\b(?!\s*\()/g
    let nestedMatch: RegExpExecArray | null
    while ((nestedMatch = nestedSpreadRegex.exec(varBody)) !== null) {
      const nested = resolveConstVariable(nestedMatch[1], primaryContent, utilsContent, depth + 1)
      Object.assign(result, nested)
    }

    // Parse any inline `field: { type, description }` definitions
    // (strip spread lines first; property-access values like `foo: bar.baz` are skipped by parser)
    const bodyWithoutVarSpreads = varBody.replace(/\.\.\.\s*\w+\b(?!\s*\()\s*,?\s*/g, '')
    const inlineOutputs = parseToolOutputsField(bodyWithoutVarSpreads)
    Object.assign(result, inlineOutputs)

    return result
  }

  return {}
}

/**
 * Recursively resolve a trigger output builder function.
 * Handles the common pattern where builders spread other builders:
 *   `return { ...buildBaseOutputs(), fieldA: { type: 'string', ... } }`
 * Also handles variable spreads:
 *   `return { ...coreOutputs, ...deploymentOutputs }`
 *
 * Searches for the function definition in `primaryContent` first, then `utilsContent`.
 * Recursion depth is capped to avoid infinite loops.
 */
function resolveTriggerBuilderFunction(
  funcName: string,
  primaryContent: string,
  utilsContent: string,
  depth = 0
): Record<string, any> {
  if (depth > 8) return {}

  const funcRegex = new RegExp(`(?:export\\s+)?function\\s+${funcName}\\s*\\(`)
  let funcBody: string | null = null

  for (const content of [primaryContent, utilsContent]) {
    const funcMatch = funcRegex.exec(content)
    if (!funcMatch) continue

    const bodyStart = content.indexOf('{', funcMatch.index)
    if (bodyStart === -1) continue

    const bodyEnd = findMatchingClose(content, bodyStart)
    if (bodyEnd === -1) continue

    funcBody = content.substring(bodyStart + 1, bodyEnd - 1)
    break
  }

  if (!funcBody) return {}

  // Handle `return anotherFunc(...)` — full delegation to another builder,
  // with or without arguments (argument values are ignored; only structure matters).
  const returnFuncCallMatch = /\breturn\s+([a-z][a-zA-Z0-9_]*)\s*\(/.exec(funcBody.trim())
  if (returnFuncCallMatch) {
    return resolveTriggerBuilderFunction(
      returnFuncCallMatch[1],
      primaryContent,
      utilsContent,
      depth + 1
    )
  }

  // Handle `return { ... }` — inline object literal
  const returnMatch = /\breturn\s*\{/.exec(funcBody)
  if (!returnMatch) return {}

  const returnObjStart = funcBody.indexOf('{', returnMatch.index)
  const returnObjEnd = findMatchingClose(funcBody, returnObjStart)
  if (returnObjEnd === -1) return {}

  const returnBody = funcBody.substring(returnObjStart + 1, returnObjEnd - 1).trim()

  const result: Record<string, any> = {}

  // Expand function-call spreads first: ...innerFuncName()
  const spreadFuncRegex = /\.\.\.\s*(\w+)\s*\(\s*\)/g
  let spreadMatch: RegExpExecArray | null
  while ((spreadMatch = spreadFuncRegex.exec(returnBody)) !== null) {
    const innerFuncName = spreadMatch[1]
    const resolved = resolveTriggerBuilderFunction(
      innerFuncName,
      primaryContent,
      utilsContent,
      depth + 1
    )
    Object.assign(result, resolved)
  }

  // Expand variable spreads: ...varName (no parentheses — const references)
  const spreadVarRegex = /\.\.\.\s*([a-zA-Z_]\w*)\b(?!\s*\()/g
  let spreadVarMatch: RegExpExecArray | null
  while ((spreadVarMatch = spreadVarRegex.exec(returnBody)) !== null) {
    const varName = spreadVarMatch[1]
    const resolved = resolveConstVariable(varName, primaryContent, utilsContent, depth + 1)
    Object.assign(result, resolved)
  }

  // Then parse any inline field definitions (strip all spread lines first)
  const bodyWithoutSpreads = returnBody
    .replace(/\.\.\.\s*\w+\s*\(\s*\)\s*,?\s*/g, '') // function call spreads
    .replace(/\.\.\.\s*\w+\b(?!\s*\()\s*,?\s*/g, '') // variable spreads
  const inlineOutputs = parseToolOutputsField(bodyWithoutSpreads)
  Object.assign(result, inlineOutputs)

  return result
}

/**
 * Extract the outputs object from a TriggerConfig segment.
 * Handles both inline `outputs: { ... }` and function-call patterns
 * like `outputs: buildIssueOutputs()`, resolving builder functions
 * from the trigger file itself and its sibling `utils.ts`.
 */
function extractTriggerOutputs(
  segment: string,
  fileContent: string,
  utilsContent: string
): Record<string, any> {
  // 1. Inline outputs: outputs: { ... }
  const outputsMatch = /\boutputs\s*:\s*\{/.exec(segment)
  if (outputsMatch) {
    const openPos = segment.indexOf('{', outputsMatch.index + outputsMatch[0].length - 1)
    if (openPos !== -1) {
      const closePos = findMatchingClose(segment, openPos)
      if (closePos !== -1) {
        const outputsContent = segment.substring(openPos + 1, closePos - 1).trim()
        return parseToolOutputsField(outputsContent)
      }
    }
  }

  // 2. Function-call outputs: outputs: buildFoo()
  const funcCallMatch = /\boutputs\s*:\s*(\w+)\s*\(\s*\)/.exec(segment)
  if (funcCallMatch) {
    return resolveTriggerBuilderFunction(funcCallMatch[1], fileContent, utilsContent)
  }

  return {}
}

/**
 * Lazy-loaded cache of all TypeScript files in `lib/webhooks/providers/`.
 * Used to resolve exported string constants that are imported by trigger utils files
 * (e.g. `GONG_JWT_PUBLIC_KEY_CONFIG_KEY` from `lib/webhooks/providers/gong.ts`).
 */
let _webhookProviderConstantsCache: string | null = null
function getWebhookProviderConstants(): string {
  if (_webhookProviderConstantsCache === null) {
    const dir = path.join(rootDir, 'apps/sim/lib/webhooks/providers')
    if (fs.existsSync(dir)) {
      _webhookProviderConstantsCache = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.ts'))
        .map((f) => fs.readFileSync(path.join(dir, f), 'utf-8'))
        .join('\n')
    } else {
      _webhookProviderConstantsCache = ''
    }
  }
  return _webhookProviderConstantsCache
}

/**
 * Try to resolve a SCREAMING_SNAKE_CASE constant to its string value by
 * searching in the given content AND the webhook provider constants cache.
 */
function resolveConstStringValue(constName: string, content: string): string | null {
  const pattern = new RegExp(`\\b${constName}\\s*=\\s*['"]([^'"]+)['"]`)
  return pattern.exec(content)?.[1] ?? pattern.exec(getWebhookProviderConstants())?.[1] ?? null
}

/**
 * Parse a single SubBlockConfig object literal into a TriggerConfigField.
 * Returns null for blocks that should be skipped (UI-only IDs, text type, readOnly).
 * Accepts optional `resolverContent` to resolve const-reference field IDs.
 */
function parseSubBlockObject(
  obj: string,
  uiOnlyIds: Set<string>,
  resolverContent?: string
): TriggerConfigField | null {
  let id: string | undefined = /\bid\s*:\s*['"]([^'"]+)['"]/.exec(obj)?.[1]

  // Handle const-reference ids: `id: SCREAMING_CASE_IDENTIFIER`
  if (!id) {
    const constRefMatch = /\bid\s*:\s*([A-Z][A-Z0-9_]+)\b/.exec(obj)
    if (constRefMatch) {
      id = resolveConstStringValue(constRefMatch[1], resolverContent ?? '') ?? undefined
    }
  }

  if (!id || uiOnlyIds.has(id)) return null

  const typeMatch = /\btype\s*:\s*['"]([^'"]+)['"]/.exec(obj)
  if (typeMatch?.[1] === 'text') return null
  if (/\breadOnly\s*:\s*true/.test(obj)) return null

  const titleMatch = /\btitle\s*:\s*['"]([^'"]+)['"]/.exec(obj)
  const requiredMatch = /\brequired\s*:\s*(true)/.exec(obj)
  const placeholderMatch = /\bplaceholder\s*:\s*['"]([^'"]+)['"]/.exec(obj)
  const descMatch = /\bdescription\s*:\s*['"]([^'"]+)['"]/.exec(obj)

  // Use title as description fallback so oauth-input and other fields without
  // an explicit description still show something meaningful in the docs table.
  const description = descMatch?.[1] ?? (titleMatch ? `${titleMatch[1]}` : undefined)

  return {
    id,
    title: titleMatch?.[1] ?? id,
    type: typeMatch?.[1] ?? 'short-input',
    required: Boolean(requiredMatch),
    placeholder: placeholderMatch?.[1],
    description,
  }
}

/**
 * Resolve a SubBlockConfig builder function to its field definitions.
 * Handles `return [...]`, `return {...}`, and `blocks.push(...)` patterns.
 * Searches `utilsContent` first, then `primaryContent`.
 */
function resolveSubBlockBuilderFunction(
  funcName: string,
  utilsContent: string,
  primaryContent?: string
): TriggerConfigField[] {
  const UI_ONLY_IDS = new Set(['webhookUrlDisplay', 'triggerInstructions', 'selectedTriggerId'])

  for (const content of [utilsContent, primaryContent ?? '']) {
    if (!content) continue
    const funcRegex = new RegExp(`(?:export\\s+)?function\\s+${funcName}\\s*\\(`)
    const funcMatch = funcRegex.exec(content)
    if (!funcMatch) continue

    // Find the closing ')' of the parameter list, then the '{' that opens the function body.
    // Using just indexOf('{') would pick up '{' inside object-type parameters.
    const openParen = content.indexOf('(', funcMatch.index)
    if (openParen === -1) continue
    const closeParen = findMatchingClose(content, openParen, '(', ')')
    if (closeParen === -1) continue
    const bodyStart = content.indexOf('{', closeParen)
    if (bodyStart === -1) continue
    const bodyEnd = findMatchingClose(content, bodyStart)
    if (bodyEnd === -1) continue

    const funcBody = content.substring(bodyStart + 1, bodyEnd - 1)

    // Pattern 1: `return [...]`
    const returnArrayMatch = /\breturn\s*\[/.exec(funcBody)
    if (returnArrayMatch) {
      const arrayStart = funcBody.indexOf('[', returnArrayMatch.index)
      const arrayEnd = findMatchingClose(funcBody, arrayStart, '[', ']')
      if (arrayEnd !== -1) {
        return parseSubBlockArrayContent(
          funcBody.substring(arrayStart + 1, arrayEnd - 1),
          UI_ONLY_IDS,
          content
        )
      }
    }

    // Pattern 2: `return { ... }` (single object)
    const returnObjMatch = /\breturn\s*\{/.exec(funcBody)
    if (returnObjMatch) {
      const objStart = funcBody.indexOf('{', returnObjMatch.index)
      const objEnd = findMatchingClose(funcBody, objStart)
      if (objEnd !== -1) {
        const field = parseSubBlockObject(
          funcBody.substring(objStart, objEnd),
          UI_ONLY_IDS,
          content
        )
        return field ? [field] : []
      }
    }

    // Pattern 3: `blocks.push({...})`
    const pushFields: TriggerConfigField[] = []
    const pushRegex = /\bblocks\.push\s*\(/g
    let pushMatch: RegExpExecArray | null
    while ((pushMatch = pushRegex.exec(funcBody)) !== null) {
      const parenStart = pushMatch.index + pushMatch[0].length - 1
      const parenEnd = findMatchingClose(funcBody, parenStart, '(', ')')
      if (parenEnd === -1) continue
      const pushArg = funcBody.substring(parenStart + 1, parenEnd - 1).trim()
      if (pushArg.startsWith('{')) {
        const field = parseSubBlockObject(pushArg, UI_ONLY_IDS, content)
        if (field) pushFields.push(field)
      }
    }
    if (pushFields.length > 0) return pushFields
  }

  return []
}

/**
 * Parse SubBlockConfig items from within an array body (between the brackets).
 * Handles inline `{...}` objects and function calls `funcName(...)`.
 */
function parseSubBlockArrayContent(
  arrayContent: string,
  uiOnlyIds: Set<string>,
  utilsContent: string
): TriggerConfigField[] {
  const fields: TriggerConfigField[] = []
  let i = 0

  while (i < arrayContent.length) {
    if (arrayContent[i] === '{') {
      const j = findMatchingClose(arrayContent, i)
      if (j === -1) break
      const field = parseSubBlockObject(arrayContent.substring(i, j), uiOnlyIds, utilsContent)
      if (field) fields.push(field)
      i = j
    } else if (/[a-zA-Z_]/.test(arrayContent[i])) {
      // Possible function call: funcName(args)
      const funcCallMatch = /^(\w+)\s*\(/.exec(arrayContent.substring(i))
      if (funcCallMatch && utilsContent) {
        const funcName = funcCallMatch[1]
        if (funcName !== 'true' && funcName !== 'false' && funcName !== 'null') {
          fields.push(...resolveSubBlockBuilderFunction(funcName, utilsContent))
        }
        // Advance past the function call's closing paren
        const openIdx = arrayContent.indexOf('(', i + funcName.length)
        if (openIdx !== -1) {
          const closeIdx = findMatchingClose(arrayContent, openIdx, '(', ')')
          i = closeIdx !== -1 ? closeIdx : openIdx + 1
        } else {
          i += funcName.length
        }
      } else {
        i++
      }
    } else {
      i++
    }
  }

  return fields
}

/**
 * Extract user-facing configuration fields from a TriggerConfig subBlocks definition.
 * Handles both inline arrays (`subBlocks: [...]`) and builder function calls
 * (`subBlocks: buildXSubBlocks({...})`), resolving them from the trigger file and utils.ts.
 */
function extractTriggerConfigFields(
  segment: string,
  primaryContent?: string,
  utilsContent?: string
): TriggerConfigField[] {
  const UI_ONLY_IDS = new Set(['webhookUrlDisplay', 'triggerInstructions', 'selectedTriggerId'])
  const allContent = utilsContent || primaryContent || ''

  // Case 1: Inline subBlocks: [...]
  const subBlocksMatch = /\bsubBlocks\s*:\s*\[/.exec(segment)
  if (subBlocksMatch) {
    const arrayStart = subBlocksMatch.index + subBlocksMatch[0].length - 1
    const arrayEnd = findMatchingClose(segment, arrayStart, '[', ']')
    if (arrayEnd === -1) return []
    return parseSubBlockArrayContent(
      segment.substring(arrayStart + 1, arrayEnd - 1),
      UI_ONLY_IDS,
      allContent
    )
  }

  // Case 2: Builder function call — subBlocks: buildXFunc(...)
  if (!allContent) return []
  const builderCallMatch = /\bsubBlocks\s*:\s*(\w+)\s*\(/.exec(segment)
  if (!builderCallMatch) return []

  const funcName = builderCallMatch[1]

  // Special case: buildTriggerSubBlocks — user config lives in the `extraFields` parameter
  if (funcName === 'buildTriggerSubBlocks') {
    const openParen = builderCallMatch.index + builderCallMatch[0].length - 1
    const closeParen = findMatchingClose(segment, openParen, '(', ')')
    if (closeParen === -1) return []

    const argsBody = segment.substring(openParen + 1, closeParen - 1)
    const extraFieldsMatch = /\bextraFields\s*:\s*/.exec(argsBody)
    if (!extraFieldsMatch) return []

    // Find first non-whitespace char after "extraFields:"
    let valuePos = extraFieldsMatch.index + extraFieldsMatch[0].length
    while (valuePos < argsBody.length && /\s/.test(argsBody[valuePos])) valuePos++

    if (argsBody[valuePos] === '[') {
      // extraFields: [...] — inline array, may contain function calls
      const arrayEnd = findMatchingClose(argsBody, valuePos, '[', ']')
      if (arrayEnd === -1) return []
      return parseSubBlockArrayContent(
        argsBody.substring(valuePos + 1, arrayEnd - 1),
        UI_ONLY_IDS,
        allContent
      )
    }

    // extraFields: buildXFunc(args) — resolve the builder function
    const extraFuncMatch = /^(\w+)\s*\(/.exec(argsBody.substring(valuePos))
    if (!extraFuncMatch) return []
    return resolveSubBlockBuilderFunction(extraFuncMatch[1], allContent)
  }

  // For all other builders, resolve the function body directly
  return resolveSubBlockBuilderFunction(funcName, allContent)
}

/**
 * Build the full trigger registry: id → TriggerFullInfo.
 * Parses every trigger source file for config fields and output schemas.
 */
async function buildFullTriggerRegistry(): Promise<Map<string, TriggerFullInfo>> {
  const registry = new Map<string, TriggerFullInfo>()
  const SKIP = new Set(['index.ts', 'registry.ts', 'types.ts', 'constants.ts', 'utils.ts'])

  const triggerFiles = (await glob(`${TRIGGERS_PATH}/**/*.ts`)).filter(
    (f) => !SKIP.has(path.basename(f)) && !f.includes('.test.')
  )

  for (const file of triggerFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8')

      // Load sibling utils.ts for resolving builder function outputs
      const utilsPath = path.join(path.dirname(file), 'utils.ts')
      const utilsContent = fs.existsSync(utilsPath) ? fs.readFileSync(utilsPath, 'utf-8') : ''

      const exportRegex = /export\s+const\s+\w+\s*:\s*TriggerConfig\s*=\s*\{/g
      let exportMatch: RegExpExecArray | null
      const exportStarts: number[] = []
      while ((exportMatch = exportRegex.exec(content)) !== null) {
        exportStarts.push(exportMatch.index)
      }

      const segments =
        exportStarts.length > 0
          ? exportStarts.map((start, i) => content.substring(start, exportStarts[i + 1]))
          : [content]

      for (const segment of segments) {
        const idMatch = /\bid\s*:\s*['"]([^'"]+)['"]/.exec(segment)
        const nameMatch = /\bname\s*:\s*['"]([^'"]+)['"]/.exec(segment)
        const descMatch = /\bdescription\s*:\s*['"]([^'"]+)['"]/.exec(segment)
        const providerMatch = /\bprovider\s*:\s*['"]([^'"]+)['"]/.exec(segment)

        if (!idMatch || !nameMatch || !providerMatch) continue

        const polling = /\bpolling\s*:\s*true/.test(segment)

        registry.set(idMatch[1], {
          id: idMatch[1],
          name: nameMatch[1],
          description: descMatch?.[1] ?? '',
          provider: providerMatch[1],
          polling,
          outputs: extractTriggerOutputs(segment, content, utilsContent),
          configFields: extractTriggerConfigFields(segment, content, utilsContent),
        })
      }
    } catch {
      // skip unreadable files silently
    }
  }

  console.log(`✓ Loaded full config for ${registry.size} triggers`)
  return registry
}

/**
 * Return the numeric version suffix of a trigger ID (e.g. `_v2` → 2, none → 1).
 * Used to prefer the latest version when the same trigger name has v1 and v2 variants.
 */
function triggerVersionOrdinal(id: string): number {
  const m = /_v(\d+)$/.exec(id)
  return m ? Number.parseInt(m[1], 10) : 1
}

/**
 * Group triggers by provider; triggers within each group are sorted alphabetically.
 * When multiple triggers share the same display name (e.g. v1 + v2 of the same event),
 * only the highest-version variant is kept so docs don't show duplicate sections.
 */
function groupTriggersByProvider(
  registry: Map<string, TriggerFullInfo>
): Map<string, TriggerFullInfo[]> {
  const groups = new Map<string, TriggerFullInfo[]>()
  for (const trigger of registry.values()) {
    const bucket = groups.get(trigger.provider) ?? []
    bucket.push(trigger)
    groups.set(trigger.provider, bucket)
  }
  for (const [provider, triggers] of groups) {
    // Deduplicate by name: keep the highest-versioned trigger for each display name
    const byName = new Map<string, TriggerFullInfo>()
    for (const trigger of triggers) {
      const existing = byName.get(trigger.name)
      if (!existing || triggerVersionOrdinal(trigger.id) > triggerVersionOrdinal(existing.id)) {
        byName.set(trigger.name, trigger)
      }
    }
    groups.set(
      provider,
      [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
    )
  }
  return groups
}

/**
 * Map subBlock UI type identifiers to semantic data types for documentation.
 * Users care about the data type (string/boolean/number), not the UI widget.
 */
const SUBBLOCK_TYPE_TO_SEMANTIC: Record<string, string> = {
  'short-input': 'string',
  'long-input': 'string',
  dropdown: 'string',
  switch: 'boolean',
  slider: 'number',
  'oauth-input': 'string',
  code: 'string',
  'file-upload': 'string',
  text: 'string',
}

function toSemanticType(uiType: string): string {
  return SUBBLOCK_TYPE_TO_SEMANTIC[uiType] ?? uiType
}

/**
 * Generate MDX content for a single trigger provider page.
 * Matches the structure of tool docs: ## Triggers, ### `trigger_id`, #### Configuration / Output.
 */
function generateTriggerProviderDoc(
  provider: string,
  triggers: TriggerFullInfo[],
  blockType: string,
  providerColor: string
): string {
  const providerName = formatTriggerProviderName(provider)
  const count = triggers.length
  const allPolling = triggers.every((t) => t.polling)
  const mixedTypes = triggers.some((t) => t.polling) && triggers.some((t) => !t.polling)

  let typeNote = ''
  if (allPolling) {
    typeNote =
      '\nAll triggers below are **polling-based** — they check for new data on a schedule rather than receiving push notifications.\n'
  } else if (mixedTypes) {
    typeNote =
      '\nSome triggers below are **polling-based** \\(checked on a schedule\\) while others are push-based webhooks.\n'
  }

  let triggersSection = ''
  for (let i = 0; i < triggers.length; i++) {
    const trigger = triggers[i]

    // Configuration table
    let configSection = ''
    if (trigger.configFields.length > 0) {
      configSection = '#### Configuration\n\n'
      configSection += '| Parameter | Type | Required | Description |\n'
      configSection += '| --------- | ---- | -------- | ----------- |\n'
      for (const field of trigger.configFields) {
        const type = toSemanticType(field.type)
        const desc = escapeMdxCell(field.description ?? field.placeholder ?? '')
        configSection += `| \`${field.id}\` | ${type} | ${field.required ? 'Yes' : 'No'} | ${desc} |\n`
      }
      configSection += '\n'
    }

    // Output table
    let outputSection = ''
    if (Object.keys(trigger.outputs).length > 0) {
      outputSection = '#### Output\n\n'
      outputSection += '| Parameter | Type | Description |\n'
      outputSection += '| --------- | ---- | ----------- |\n'
      outputSection += formatOutputStructure(trigger.outputs)
      outputSection += '\n'
    }

    const separator = i < triggers.length - 1 ? '\n---\n\n' : ''

    triggersSection += `### ${trigger.name}\n\n`
    triggersSection += `${trigger.description}\n\n`
    triggersSection += configSection
    triggersSection += outputSection
    triggersSection += separator
  }

  return `---
title: ${providerName}
description: Available ${providerName} triggers for automating workflows
---

import { BlockInfoCard } from "@/components/ui/block-info-card"

<BlockInfoCard
  type="${blockType}"
  color="${providerColor}"
/>

${providerName} provides ${count} trigger${count === 1 ? '' : 's'} for automating workflows based on events.
${typeNote}
## Triggers

${triggersSection}`
}

/**
 * Update triggers/meta.json, preserving hand-written entries and appending
 * generated provider pages sorted alphabetically.
 */
function updateTriggerMetaJson(generatedProviders: string[]): void {
  const metaJsonPath = path.join(TRIGGER_DOCS_OUTPUT_PATH, 'meta.json')

  let existingPages: string[] = []
  if (fs.existsSync(metaJsonPath)) {
    try {
      existingPages = JSON.parse(fs.readFileSync(metaJsonPath, 'utf-8')).pages ?? []
    } catch {
      existingPages = []
    }
  }

  const handWritten = existingPages.filter((p) => HANDWRITTEN_TRIGGER_DOCS.has(p))
  const sortedGenerated = [...generatedProviders].sort()
  const pages = [...handWritten, ...sortedGenerated]

  fs.writeFileSync(metaJsonPath, `${JSON.stringify({ pages }, null, 2)}\n`)
  console.log(`✓ Updated trigger meta.json with ${pages.length} entries`)
}

/**
 * Build a map of block-type → bgColor from all block definitions.
 * Used to pick provider colours for the BlockInfoCard on trigger pages.
 */
async function buildProviderColorMap(): Promise<Map<string, string>> {
  const colorMap = new Map<string, string>()
  const blockFiles = (await glob(`${BLOCKS_PATH}/*.ts`)).sort()

  for (const blockFile of blockFiles) {
    const fileContent = fs.readFileSync(blockFile, 'utf-8')
    const configs = extractAllBlockConfigs(fileContent)
    for (const config of configs) {
      if (config.bgColor && config.type) {
        const baseType = stripVersionSuffix(config.type)
        if (!colorMap.has(baseType)) colorMap.set(baseType, config.bgColor)
      }
    }
  }

  return colorMap
}

/**
 * Generate one MDX file per trigger provider and update the sidebar meta.json.
 * Hand-written docs (HANDWRITTEN_TRIGGER_DOCS) are never touched.
 */
async function generateAllTriggerDocs(): Promise<void> {
  try {
    console.log('Generating trigger documentation...')

    if (!fs.existsSync(TRIGGER_DOCS_OUTPUT_PATH)) {
      fs.mkdirSync(TRIGGER_DOCS_OUTPUT_PATH, { recursive: true })
    }

    const fullRegistry = await buildFullTriggerRegistry()
    const grouped = groupTriggersByProvider(fullRegistry)
    const colorMap = await buildProviderColorMap()

    const generatedProviders: string[] = []

    for (const [provider, triggers] of grouped) {
      if (SKIP_TRIGGER_PROVIDERS.has(provider)) {
        console.log(`Skipping trigger provider: ${provider} (covered by hand-written docs)`)
        continue
      }

      const outputFilePath = path.join(TRIGGER_DOCS_OUTPUT_PATH, `${provider}.mdx`)

      // Never overwrite hand-written docs
      if (fs.existsSync(outputFilePath)) {
        const baseName = path.basename(outputFilePath, '.mdx')
        if (HANDWRITTEN_TRIGGER_DOCS.has(baseName)) {
          console.log(`Skipping ${provider} — hand-written doc exists`)
          continue
        }
      }

      // Resolve the block type to use for BlockInfoCard (handles provider ≠ block type)
      const blockType = PROVIDER_TO_BLOCK_TYPE[provider] ?? provider
      const providerColor = colorMap.get(blockType) ?? '#6B7280'

      const existingContent = fs.existsSync(outputFilePath)
        ? fs.readFileSync(outputFilePath, 'utf-8')
        : null

      // Only preserve manual sections that have actual user-authored content.
      // Empty markers (left from a prior generation) are silently discarded so
      // they don't accumulate on each subsequent run.
      const rawSections = existingContent ? extractManualContent(existingContent) : {}
      const manualSections = Object.fromEntries(
        Object.entries(rawSections).filter(([, v]) => v.length > 0)
      )

      const markdown = generateTriggerProviderDoc(provider, triggers, blockType, providerColor)

      const finalContent =
        Object.keys(manualSections).length > 0
          ? mergeWithManualContent(markdown, existingContent, manualSections)
          : markdown

      fs.writeFileSync(outputFilePath, finalContent)
      generatedProviders.push(provider)
      console.log(
        `✓ Generated trigger docs for ${formatTriggerProviderName(provider)} (${triggers.length} trigger${triggers.length === 1 ? '' : 's'})`
      )
    }

    updateTriggerMetaJson(generatedProviders)
    console.log(
      `✓ Trigger documentation generation complete: ${generatedProviders.length} provider pages`
    )
  } catch (error) {
    console.error('Error generating trigger documentation:', error)
  }
}

async function generateAllBlockDocs() {
  try {
    // Copy icons from sim app to docs app
    copyIconsFile()

    // Generate icon mapping from block definitions
    const iconMapping = await generateIconMapping()
    writeIconMapping(iconMapping)

    // Generate landing integrations page data (JSON + icon mapping)
    await writeIntegrationsJson(iconMapping)
    writeIntegrationsIconMapping(iconMapping)

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

    // Generate trigger provider documentation
    await generateAllTriggerDocs()

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

  fs.writeFileSync(metaJsonPath, `${JSON.stringify(metaJson, null, 2)}\n`)
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
