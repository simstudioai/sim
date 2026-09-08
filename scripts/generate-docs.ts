#!/usr/bin/env ts-node
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { isVersionedType, stripVersionSuffix } from '@sim/utils/string'
import { glob } from 'glob'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import type { BlockCategory } from '../apps/sim/blocks/types'
import { IntegrationType } from '../apps/sim/blocks/types'
import type { ToolOutputProperty } from '../apps/sim/tools/types'

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
export const DOCS_OUTPUT_PATH = path.join(rootDir, 'apps/docs/content/docs/integrations')

export const DOCS_ORIGIN = 'https://docs.sim.ai/'

/**
 * The docs URL a block gets when it declares no `docsLink` — one generated page
 * per service, named for the block's base type. Exported so the catalog checker
 * validates the same contract this generator emits rather than a second copy of
 * it that can silently drift.
 */
export function defaultIntegrationDocsUrl(blockType: string): string {
  return `${DOCS_ORIGIN}integrations/${stripVersionSuffix(blockType)}`
}
const ICONS_PATH = path.join(rootDir, 'apps/sim/components/icons.tsx')
const DOCS_ICONS_PATH = path.join(rootDir, 'apps/docs/components/icons.tsx')
const INTEGRATIONS_DATA_PATH = path.join(rootDir, 'apps/sim/lib/integrations')
const INTEGRATIONS_CATALOG_PATH = path.join(rootDir, 'packages/deployment-config/src')
const LANDING_INTEGRATIONS_DATA_PATH = path.join(
  rootDir,
  'apps/sim/app/(landing)/integrations/data'
)
const TRIGGERS_PATH = path.join(rootDir, 'apps/sim/triggers')
const sourceFileCache = new Map<string, string>()
const sourceGlobCache = new Map<string, Promise<string[]>>()
const blockConfigCache = new Map<string, ReturnType<typeof extractAllBlockConfigs>>()

function readSourceFile(filePath: string): string {
  const cached = sourceFileCache.get(filePath)
  if (cached !== undefined) return cached
  const source = fs.readFileSync(filePath, 'utf-8')
  sourceFileCache.set(filePath, source)
  return source
}

async function sourceGlob(pattern: string): Promise<string[]> {
  let pending = sourceGlobCache.get(pattern)
  if (!pending) {
    pending = glob(pattern)
    sourceGlobCache.set(pattern, pending)
  }
  return [...(await pending)]
}

function blockConfigsForFile(filePath: string): ReturnType<typeof extractAllBlockConfigs> {
  const cached = blockConfigCache.get(filePath)
  if (cached) return cached
  const configs = extractAllBlockConfigs(readSourceFile(filePath))
  blockConfigCache.set(filePath, configs)
  return configs
}
// Integration triggers are merged into the same per-service page as the service's
// actions (one block per integration: actions + an optional Trigger).
const TRIGGER_DOCS_OUTPUT_PATH = DOCS_OUTPUT_PATH

const integrationNavigation = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'apps/docs/content/integration-navigation.json'), 'utf-8')
) as { guides: Record<string, unknown>; redirects: Record<string, string> }

/**
 * Hand-written integration pages in DOCS_OUTPUT_PATH that the generator must
 * never clobber. Hand-authored credential guides are registered in the shared
 * docs navigation file — these pages carry no `MANUAL-CONTENT` markers and no
 * backing block, so the stale-doc cleanup deletes any that go unregistered.
 */
const HANDWRITTEN_INTEGRATION_DOCS = new Set([
  'index',
  'a2a',
  ...Object.keys(integrationNavigation.guides),
])

/**
 * Native Sim resource blocks (category 'blocks') that still get a generated
 * integration page. The writer's filter, the stale-doc cleanup, and the icon
 * map must all honor this set: cleanup would otherwise delete what the writer
 * emits (losing manual content), and an icon map that omits these types leaves
 * their pages rendering the two-letter text fallback instead of the icon.
 */
const NATIVE_RESOURCE_BLOCK_TYPES = new Set([
  'memory',
  'knowledge',
  'table',
  'enrichment',
  'logs',
  'deployments',
])

/** Trigger doc pages that are hand-written and must never be overwritten. */
const HANDWRITTEN_TRIGGER_DOCS = new Set([
  'index',
  'start',
  'schedule',
  'webhook',
  'rss',
  'table',
  'sim',
])

/** Omits hand-written providers and Slack's superseded legacy webhook trigger. */
const SKIP_TRIGGER_PROVIDERS = new Set(['generic', 'rss', 'table', 'sim', 'slack'])

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
  jsm: 'jira_service_management',
  slack_app: 'slack',
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
  tiktok: 'TikTok',
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

const docsComponentsDir = path.dirname(DOCS_ICONS_PATH)
if (!fs.existsSync(docsComponentsDir)) {
  fs.mkdirSync(docsComponentsDir, { recursive: true })
}

/** Runtime set of valid `IntegrationType` values, derived from the canonical enum. */
const INTEGRATION_CATEGORY_VALUES: ReadonlySet<IntegrationType> = new Set(
  Object.values(IntegrationType)
)

/**
 * Defensive shape for blocks parsed out of source files. Fields stay loose
 * (`string`) so the AST-style extractor can populate them progressively; the
 * canonical taxonomy is enforced at the JSON-write boundary inside
 * `writeIntegrationsJson`.
 */
interface BlockConfig {
  type: string
  name: string
  description: string
  longDescription?: string
  category: string
  integrationType?: string
  bgColor?: string
  outputs?: Record<string, any>
  tools?: {
    access?: string[]
  }
  operations?: OperationInfo[]
  /**
   * Param names the block itself supplies — via a `subBlocks` field (id or
   * `canonicalParamId`) or via its `tools.config.params` mapper.
   *
   * `null` means the block's `subBlocks` array could not be read, so which params it supplies
   * is UNKNOWN and the hidden-param filter is skipped for it. Never conflate that with `[]`,
   * which asserts the block supplies nothing and strips every hidden param from its page.
   */
  userSettableParamIds?: string[] | null
  docsLink?: string
  [key: string]: any
}

/**
 * True when a block's source text marks it as an unreleased `preview: true`
 * block. THE single preview gate for this script — every surface it emits
 * (docs .mdx, integrations.json, icon mapping) must consult this, because a
 * missed gate publishes an unreleased block to docs.sim.ai, the catalog, the
 * sitemap, and OG images. Mirrors the `hideFromToolbar` source-text checks.
 */
function isPreviewSource(blockContent: string): boolean {
  return /preview\s*:\s*true/.test(blockContent)
}

/**
 * Blank out `//` and block comments so source-text property probes match real
 * code only. Without this, prose that quotes a property — e.g. slack.ts's
 * "At v2 GA this becomes `hideFromToolbar: true`" — reads as the property
 * itself and silently drops the block from every generated surface.
 *
 * Comment bodies are replaced with spaces rather than removed so byte offsets
 * stay aligned with the original content. Deliberately not applied to
 * {@link isPreviewSource}: that gate is fail-closed on purpose, and a
 * false positive there only over-hides an unreleased block.
 */
function stripSourceComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, prefix) => prefix + ' '.repeat(m.length - prefix.length))
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

/** The subset of `SubBlockConfig` the generated configuration table reads. */
interface RegistrySubBlock {
  id?: string
  type?: string
  title?: string
  description?: string
  placeholder?: unknown
  /** `true`, or a condition object making the field required only for some configurations. */
  required?: unknown
  hidden?: boolean
  readOnly?: boolean
}

interface RegistryTrigger {
  id?: string
  name?: string
  provider?: string
  description?: string
  polling?: boolean
  deprecated?: boolean
  subBlocks?: RegistrySubBlock[]
  outputs?: Record<string, any>
}

/** Present for the operator, not part of a trigger's configuration surface. */
const TRIGGER_UI_ONLY_IDS = new Set([
  'webhookUrlDisplay',
  'triggerInstructions',
  'selectedTriggerId',
])

/**
 * Loads the evaluated trigger registry.
 *
 * Imported by absolute path so Bun resolves the `@/` aliases against `apps/sim`'s tsconfig
 * rather than this script's.
 */
async function loadTriggerRegistry(): Promise<Record<string, RegistryTrigger>> {
  const module = await import(path.join(rootDir, 'apps/sim/triggers/registry.ts'))
  return module.TRIGGER_REGISTRY as Record<string, RegistryTrigger>
}

interface ToolMetadataParam {
  type?: string
  required?: boolean
  description?: string
  visibility?: string
}

interface ToolMetadataEntry {
  name?: string
  description?: string
  params?: Record<string, ToolMetadataParam>
}

/** Client-safe tool metadata, keyed by tool id and kept in sync with the registry by CI. */
let toolMetadata: Record<string, ToolMetadataEntry> | null = null

async function loadToolMetadata(): Promise<Record<string, ToolMetadataEntry>> {
  if (toolMetadata) return toolMetadata
  const module = await import(path.join(rootDir, 'apps/sim/tools/generated/tool-metadata.ts'))
  toolMetadata = module.default as Record<string, ToolMetadataEntry>
  return toolMetadata
}

/** Evaluated tool output schemas, keyed by tool id and kept in sync with the registry by CI. */
let toolOutputs: Record<string, Record<string, ToolOutputProperty>> | null = null

async function loadToolOutputs(): Promise<Record<string, Record<string, ToolOutputProperty>>> {
  if (toolOutputs) return toolOutputs
  const module = await import(path.join(rootDir, 'apps/sim/tools/generated/tool-outputs.ts'))
  toolOutputs = module.default as Record<string, Record<string, ToolOutputProperty>>
  return toolOutputs
}

/** Human-facing tool names, keyed by tool id. Kept in sync with the registry by CI. */
let toolDisplayNames: Map<string, string> | null = null

async function loadToolDisplayNames(): Promise<Map<string, string>> {
  if (toolDisplayNames) return toolDisplayNames
  const metadata = await loadToolMetadata()
  toolDisplayNames = new Map(
    Object.entries(metadata).flatMap(([id, entry]) =>
      entry?.name ? [[id, entry.name] as const] : []
    )
  )
  return toolDisplayNames
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
  oauthServiceId?: string
  category: BlockCategory
  integrationType: IntegrationType
  tags?: string[]
  landingContent?: Record<string, unknown>
}

/** A block icon component together with the module it must be imported from. */
interface IconRef {
  name: string
  source: string
}

/**
 * Check mode (`--check`): render every generated artifact in memory and compare
 * it against the committed file instead of writing, so CI can fail on docs
 * drift the same way `tool-metadata:check` fails on stale tool metadata. Check
 * mode performs no filesystem mutations.
 *
 * The pipeline writes some pages twice per run — the block pass writes the base
 * page, then the trigger pass reads it back and appends/merges the Triggers
 * section — so check mode keeps an in-memory overlay of everything "written"
 * this run (`emittedByPath`), readers consult the overlay before disk
 * (`readGeneratedFile`), and staleness is judged once at the end against each
 * artifact's FINAL content. Comparing at emit time would flag the intermediate
 * block-pass content of every trigger-owning page as a false positive.
 *
 * Known limitation: `updateMetaJson` derives the sidebar from the mdx files on
 * disk, so in check mode a brand-new block's missing page is reported directly
 * while the corresponding meta.json entry is not — regenerating fixes both.
 */
let CHECK_ONLY = false
const staleArtifacts: string[] = []
const emittedByPath = new Map<string, string>()

/**
 * Deletion candidates recorded by cleanup in check mode. Judged at the end of
 * the run, not at cleanup time: generate mode deletes a non-canonical page and
 * lets the trigger pass recreate it in the same run, so a candidate that was
 * re-emitted this run is that delete-then-recreate dance — content drift (if
 * any) is already covered by the overlay comparison — while a candidate nothing
 * re-emitted is a genuinely stale page regeneration would remove.
 */
const wouldDeletePaths: string[] = []

/** Writes a generated artifact, or in check mode records its final content for the end-of-run comparison. */
function emitGeneratedFile(filePath: string, content: string): void {
  if (CHECK_ONLY) {
    emittedByPath.set(filePath, content)
    return
  }
  fs.writeFileSync(filePath, content)
}

/** Reads a generated artifact as the pipeline would see it mid-run: overlay first in check mode, then disk. */
function readGeneratedFile(filePath: string): string | null {
  const emitted = emittedByPath.get(filePath)
  if (emitted !== undefined) return emitted
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null
}

/** Compares every overlay entry against the committed file; returns repo-relative stale paths. */
function collectStaleEmissions(): string[] {
  const stale: string[] = []
  for (const [filePath, content] of emittedByPath) {
    const committed = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null
    if (committed !== content) stale.push(path.relative(rootDir, filePath))
  }
  return stale
}

/**
 * Copy the icons.tsx file from the main sim app to the docs app
 * This ensures icons are rendered consistently across both apps
 */
function copyIconsFile(): void {
  try {
    if (!CHECK_ONLY) console.log('Copying icons from sim app to docs app...')

    if (!fs.existsSync(ICONS_PATH)) {
      console.error(`Source icons file not found: ${ICONS_PATH}`)
      return
    }

    const iconsContent = readSourceFile(ICONS_PATH)
    emitGeneratedFile(DOCS_ICONS_PATH, iconsContent)

    if (!CHECK_ONLY) console.log('✓ Icons successfully copied to docs app')
  } catch (error) {
    console.error('Error copying icons file:', error)
  }
}

/**
 * Some trigger providers have no block of their own (`slack_app`, `twilio`) yet
 * still get a generated page keyed by the provider id. Seed those provider ids
 * from the trigger definitions' own `icon` so their pages render the brand mark
 * instead of the two-letter fallback. Never overwrites a block-derived entry —
 * the block is the canonical icon source when one exists.
 */
async function addTriggerProviderIcons(
  iconMappings: readonly Record<string, IconRef>[]
): Promise<void> {
  const triggerFiles = (await sourceGlob(`${TRIGGERS_PATH}/**/*.ts`)).filter(
    (f) => !f.includes('.test.')
  )
  const previewOnly = await collectPreviewOnlyTriggerIds()

  for (const file of triggerFiles) {
    const fileContent = readSourceFile(file)
    const source = stripSourceComments(fileContent)

    // Pair each trigger's `id` with the `provider` that follows it in the same
    // config, so files holding several trigger configs attribute each provider
    // (and its icon) to the right trigger.
    const configRegex =
      /\bid\s*:\s*['"]([^'"]+)['"][\s\S]{0,600}?\bprovider\s*:\s*['"]([^'"]+)['"]/g

    for (const match of source.matchAll(configRegex)) {
      const [, triggerId, provider] = match
      if (iconMappings.every((iconMapping) => iconMapping[provider])) continue

      // Preview-only triggers get no page, so they need no provider icon.
      if (previewOnly.has(triggerId)) continue

      const iconName = extractIconNameFromContent(source.slice(match.index))
      if (!iconName) continue

      const iconRef = { name: iconName, source: resolveIconSource(fileContent, iconName) }
      for (const iconMapping of iconMappings) {
        if (!iconMapping[provider]) iconMapping[provider] = iconRef
      }
    }
  }
}

/**
 * Generate icon mapping from block definitions.
 * Docs need hidden historical version keys so old BlockInfoCard references and
 * versioned docs links still render icons, while landing only needs visible blocks.
 */
export async function generateIconMappings(): Promise<{
  docs: Record<string, IconRef>
  visible: Record<string, IconRef>
  coreBlockTypes: string[]
}> {
  try {
    console.log('Generating icon mapping from block definitions...')

    const docs: Record<string, IconRef> = {}
    const visible: Record<string, IconRef> = {}
    const coreBlockTypes = new Set<string>()
    const blockFiles = (await sourceGlob(`${BLOCKS_PATH}/*.ts`)).sort()

    for (const blockFile of blockFiles) {
      const fileContent = readSourceFile(blockFile)

      // For icon mapping, we need ALL blocks including hidden ones
      // because V2 blocks inherit icons from legacy blocks via spread
      // First, extract the primary icon from the file (usually the legacy block's icon)
      const primaryIcon = extractIconNameFromContent(fileContent)

      const exportRegex = /export\s+const\s+(\w+)Block\s*:\s*BlockConfig[^=]*=\s*\{/g
      let match

      while ((match = exportRegex.exec(fileContent)) !== null) {
        const blockName = match[1]
        const startIndex = match.index + match[0].length - 1

        const endIndex = findMatchingClose(fileContent, startIndex)

        if (endIndex !== -1) {
          const blockContent = fileContent.substring(startIndex, endIndex)

          // Check hideFromToolbar - skip hidden blocks for docs but NOT for icon mapping
          const hideFromToolbar = /hideFromToolbar\s*:\s*true/.test(
            stripSourceComments(blockContent)
          )

          // Unreleased preview blocks never reach any public surface, icon map included.
          if (isPreviewSource(blockContent)) {
            continue
          }

          const blockType =
            extractStringPropertyFromContent(blockContent, 'type') || blockName.toLowerCase()

          const iconName = extractIconNameFromContent(blockContent) || primaryIcon

          if (!blockType || !iconName) {
            continue
          }

          const category = extractStringPropertyFromContent(blockContent, 'category') || 'misc'
          const iconRef = {
            name: iconName,
            source: resolveIconSource(fileContent, iconName),
          }
          /** Core reference previews share the registry's glyphs without entering the integration catalog. */
          const inheritedCategory = extractInheritedBlockCategory(blockContent, fileContent)
          if (inheritedCategory === 'blocks' || inheritedCategory === 'triggers') {
            docs[blockType] = iconRef
            coreBlockTypes.add(blockType)
          }

          if (
            blockType.includes('_trigger') ||
            blockType.includes('_webhook') ||
            blockType.includes('rss')
          ) {
            continue
          }

          // Exclude first-party `blocks`-category primitives (except the native
          // resource blocks that still get a generated docs page) and
          // core/plumbing types. Keying the exception off
          // `NATIVE_RESOURCE_BLOCK_TYPES` — the same set the docs writer uses —
          // keeps the icon map from drifting behind the pages that consume it.
          const baseType = stripVersionSuffix(blockType)
          if (
            (category === 'blocks' &&
              !NATIVE_RESOURCE_BLOCK_TYPES.has(baseType) &&
              !HANDWRITTEN_INTEGRATION_DOCS.has(baseType)) ||
            ICON_MAP_EXCLUDED_TYPES.has(blockType)
          ) {
            continue
          }

          const isVersionedBlockType = isVersionedType(blockType)
          /**
           * A sunset block keeps its docs page — `docsLink` is baked into every
           * placed instance — so it still needs an icon there, exactly like a
           * hidden versioned block. Without this it renders as a text tile.
           */
          const isSunsetBlockType = /sunset\s*:\s*\{/.test(stripSourceComments(blockContent))
          if (!hideFromToolbar) {
            docs[blockType] = iconRef
            visible[blockType] = iconRef
          } else if (isVersionedBlockType || isSunsetBlockType) {
            docs[blockType] = iconRef
          }
        }
      }
    }

    await addTriggerProviderIcons([docs, visible])

    console.log(
      `✓ Generated icon mappings for ${Object.keys(docs).length} docs blocks and ` +
        `${Object.keys(visible).length} visible blocks`
    )
    return { docs, visible, coreBlockTypes: [...coreBlockTypes].sort() }
  } catch (error) {
    console.error('Error generating icon mapping:', error)
    return { docs: {}, visible: {}, coreBlockTypes: [] }
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

function writeIconMapping(iconMapping: Record<string, IconRef>, coreBlockTypes: string[]): void {
  try {
    const iconMappingPath = path.join(rootDir, 'apps/docs/components/ui/icon-mapping.ts')

    // Add bare-name aliases for versioned block types so trigger provider names resolve correctly.
    // e.g. github_v2 → github, fireflies_v2 → fireflies, gmail_v2 → gmail
    const withAliases: Record<string, IconRef> = { ...iconMapping }
    for (const [blockType, iconRef] of Object.entries(iconMapping)) {
      const baseType = stripVersionSuffix(blockType)
      if (baseType !== blockType && !withAliases[baseType]) {
        withAliases[baseType] = iconRef
      }
    }

    const imports = renderIconImports(Object.values(withAliases))
    const coreTypeEntries = coreBlockTypes.map((type) => `  '${type}',`).join('\n')

    // Generate mapping with direct references (no dynamic access for tree shaking)
    const mappingEntries = Object.entries(withAliases)
      .sort(([a], [b]) => compareCatalogNames(a, b))
      .map(([blockType, iconRef]) => `  ${formatIconMapKey(blockType)}: ${iconRef.name},`)
      .join('\n')

    const content = `// Auto-generated file - do not edit manually
// Generated by scripts/generate-docs.ts
// Maps block types to their icon component references

import type { ComponentType, SVGProps } from 'react'
${imports}

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

export const blockTypeToIconMap: Record<string, IconComponent> = {
${mappingEntries}
}

export const coreBlockTypes = new Set([
${coreTypeEntries}
])
`

    emitGeneratedFile(iconMappingPath, content)
    if (!CHECK_ONLY) console.log('✓ Icon mapping file written to docs app')
  } catch (error) {
    console.error('Error writing icon mapping:', error)
  }
}

/**
 * Raised when a block's `subBlocks` array is present but cannot be read. Distinguishes
 * a parse failure from a block that genuinely exposes no fields — both used to surface
 * as an empty array, and the empty array silently strips documented rows.
 */
class SubBlockParseError extends Error {
  override name = 'SubBlockParseError'
}

/** Blocks already warned about. The same block is re-parsed by the page pass, the icon pass and
 * each spread-base recursion, so without this the same warning prints several times. */
const subBlockParseWarnings = new Set<string>()

/**
 * Collects the param names a block exposes to the user through its own `subBlocks`.
 *
 * A subBlock's `id` is the param it writes, unless it declares `canonicalParamId`,
 * which is how a differently-named field maps onto a tool param. A tool param marked
 * `visibility: 'hidden'` is not an LLM-settable tool argument, but when the block
 * declares a matching field the value is still typed by the user (e.g. Mailchimp's
 * `apiKey`) and must stay documented. Params with no matching field are genuinely
 * server-derived (Jira's `cloudId`, Salesforce's `idToken`) and stay filtered out.
 *
 * Brace matching runs on a blanked copy so braces inside string literals and comments
 * cannot skew it; only depth-1 properties of each subBlock are read, so `id` fields on
 * nested `options`/`condition` objects are never mistaken for the subBlock's own id.
 *
 * Returns `null` for UNKNOWN — an array whose elements are all spreads of fields arrays this
 * scanner cannot follow (`...NotionBlock.subBlocks`, `...getTrigger('x').subBlocks`). `[]` is
 * reserved for a block that genuinely exposes no fields, because `[]` strips every hidden param
 * from the page. Throws {@link SubBlockParseError} when the array is there but unreadable.
 */
export function extractUserSettableParamIds(
  blockContent: string,
  blockName = 'block'
): string[] | null {
  const scannable = blankStringsAndComments(blockContent)
  if (scannable === null) return null
  const keyMatch = /\bsubBlocks\s*:/.exec(scannable)
  if (!keyMatch) return []

  const afterKey = keyMatch.index + keyMatch[0].length
  const literalMatch = /^\s*\[/.exec(scannable.slice(afterKey))
  if (!literalMatch) {
    throw new SubBlockParseError(
      `${blockName}: subBlocks is built by an expression rather than an array literal, so the fields it contributes cannot be read`
    )
  }

  const arrayStart = afterKey + literalMatch[0].length - 1
  const arrayEnd = findMatchingClose(scannable, arrayStart, '[', ']')
  if (arrayEnd === -1) {
    throw new SubBlockParseError(
      `${blockName}: found a subBlocks array but could not locate its closing bracket`
    )
  }

  const ids = new Set<string>()
  let elementsWithoutIds = 0

  /**
   * Text of the array's own elements with every object literal, call argument and nested
   * bracket elided, so each remaining comma-separated segment is one element's head. Used to
   * tell an element that names an existing fields array from one that hides its fields behind
   * a helper call.
   */
  let elementHeads = ''
  let nesting = 0
  let i = arrayStart + 1

  while (i < arrayEnd - 1) {
    const char = scannable[i]

    if (nesting === 0 && char === '{') {
      const objectEnd = findMatchingClose(scannable, i)
      if (objectEnd === -1) break

      let depth = 0
      let topLevel = ''
      const sourceIndices: number[] = []
      for (let k = i; k < objectEnd; k++) {
        const inner = scannable[k]
        if (inner === '{' || inner === '[') {
          depth++
          continue
        }
        if (inner === '}' || inner === ']') {
          depth--
          continue
        }
        if (depth === 1) {
          topLevel += inner
          sourceIndices.push(k)
        }
      }

      /**
       * Matching runs on the blanked characters, so an `id:` sitting inside a string value or a
       * `//` comment cannot be mistaken for the subBlock's own id. Blanking keeps a string's
       * quotes and its length, so the matched literal's value is read back character by character
       * from the original content at the indices the blanked copy matched at.
       */
      const readLiteral = (match: RegExpExecArray): string => {
        const valueStart = match.index + match[0].length - 1 - match[1].length
        let value = ''
        for (let offset = 0; offset < match[1].length; offset++) {
          value += blockContent[sourceIndices[valueStart + offset]]
        }
        return value
      }

      const idMatch = /\bid\s*:\s*['"]([^'"]+)['"]/.exec(topLevel)
      if (idMatch) ids.add(readLiteral(idMatch))
      const canonicalMatch = /\bcanonicalParamId\s*:\s*['"]([^'"]+)['"]/.exec(topLevel)
      if (canonicalMatch) ids.add(readLiteral(canonicalMatch))

      /**
       * An object that spreads an existing subBlock to override one property
       * (`{ ...sb, required: true }`) legitimately carries no id of its own — the id comes from
       * the spread source. Only an object with neither an id nor a spread means the scan failed.
       */
      if (!idMatch && !canonicalMatch && !topLevel.includes('...')) elementsWithoutIds++

      i = objectEnd
      continue
    }

    if (char === '(' || char === '[') {
      nesting++
      i++
      continue
    }
    if (char === ')' || char === ']') {
      nesting--
      i++
      continue
    }
    if (nesting === 0) elementHeads += char
    i++
  }

  /**
   * Any id at all means the array was read and the page keeps a populated Input table. An
   * opaque element alongside real ids can only omit extra rows — the long-standing limitation
   * that a spread contributes ids this scanner never sees — and is not this guard's business.
   * The guard exists solely to stop an empty result, because empty is what strips every hidden
   * param from the page.
   */
  if (ids.size > 0) return [...ids]

  if (elementsWithoutIds > 0) {
    throw new SubBlockParseError(
      `${blockName}: subBlocks array holds object literals but no id was extracted`
    )
  }

  /**
   * Zero ids is a legitimate answer only when every element names an existing fields array
   * (`...NotionBlock.subBlocks`, `...getTrigger('x').subBlocks`, `...Base.subBlocks.filter(…)`),
   * because those fields reach the page through the spread base instead. An element that is a
   * bare helper call (`...getSlackV2ActionSubBlocks()`) hides whatever fields the helper builds,
   * and used to yield a silent empty array indistinguishable from a spread-only block.
   */
  const segments = elementHeads
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
  const opaque = segments.filter((segment) => !segment.includes('.subBlocks'))
  if (opaque.length > 0) {
    throw new SubBlockParseError(
      `${blockName}: subBlocks array yielded no ids and element${
        opaque.length > 1 ? 's' : ''
      } ${opaque.map((segment) => `\`${segment}\``).join(', ')} do not name a fields array`
    )
  }

  /**
   * Every element named a fields array this scanner cannot follow, so the block's fields are
   * UNKNOWN, not empty. Returning `[]` here would assert the block supplies nothing and strip
   * every hidden param from its tools' Input tables with no warning — the silent false-drop the
   * `null` state exists to prevent. Only a genuinely empty array (`subBlocks: []`) reaches the
   * `[]` below.
   */
  if (segments.length > 0) return null

  return []
}

/**
 * Locates the bodies of every `tools.config.params` mapper in `scannable`.
 *
 * Returns `[start, end)` index pairs into `scannable` (a length-preserving blanked copy, so
 * the same indices address the original content).
 *
 * In production this only ever runs on a single block's slice, which holds at most one
 * `subBlocks:` key — the loop over every `tools` object is defensive rather than required, and
 * the multi-block file it was once justified by (Textract's v1 and v2) is split before it gets
 * here. The tests do pass whole files, so the loop is exercised on wider input than production
 * ever supplies.
 *
 * Handles `params: (params) => { ... }`, the concise `params: (params) => ({ ... })` form, the
 * `async` and generic-annotated variants, and method shorthand. Candidates are tried in order
 * rather than only the first, because a decoy key that is not a mapper at all
 * (`params: (GitHubBlock.tools?.config as any)?.params`) would otherwise mask the real one.
 */
function findMapperBodyRanges(scannable: string): [number, number][] {
  const ranges: [number, number][] = []
  const toolsRegex = /\btools\s*:\s*\{/g
  let toolsMatch: RegExpExecArray | null

  while ((toolsMatch = toolsRegex.exec(scannable)) !== null) {
    const toolsEnd = findMatchingClose(scannable, toolsMatch.index + toolsMatch[0].length - 1)
    if (toolsEnd === -1) continue
    toolsRegex.lastIndex = toolsEnd

    const toolsRegion = scannable.slice(toolsMatch.index, toolsEnd)
    const configMatch = /\bconfig\s*:\s*\{/.exec(toolsRegion)
    if (!configMatch) continue
    const configStart = toolsMatch.index + configMatch.index + configMatch[0].length - 1
    const configEnd = findMatchingClose(scannable, configStart)
    if (configEnd === -1) continue

    const configRegion = scannable.slice(configStart, configEnd)
    const paramsRegex = /\bparams\s*(?::\s*(?:async\s*)?(?:<[^<>]*>\s*)?)?\(/g
    let paramsMatch: RegExpExecArray | null

    while ((paramsMatch = paramsRegex.exec(configRegion)) !== null) {
      const argsStart = configStart + paramsMatch.index + paramsMatch[0].length - 1
      const argsEnd = findMatchingClose(scannable, argsStart, '(', ')')
      if (argsEnd === -1) continue

      const afterArgs = scannable.slice(argsEnd, configEnd)
      const bodyMatch = /^\s*(?::[^=({]*)?(?:=>\s*)?([({])/.exec(afterArgs)
      if (!bodyMatch) continue
      const open = bodyMatch[1] as '(' | '{'
      const bodyStart = argsEnd + bodyMatch[0].length - 1
      const bodyEnd = findMatchingClose(scannable, bodyStart, open, open === '(' ? ')' : '}')
      if (bodyEnd === -1) continue
      ranges.push([bodyStart, bodyEnd])
      break
    }
  }

  return ranges
}

/**
 * Adds the shorthand property names of every object literal in `body` to `into`.
 *
 * `{ file }` names the `file` param exactly as `{ file: value }` does, but carries no colon,
 * so the key scan below cannot see it — a mapper written in the idiomatic shorthand form used
 * to drop the param from the docs silently, which is the one failure mode this whole filter
 * exists to prevent.
 *
 * Only the depth-1 comma segments of a brace-matched region are read, and a segment that
 * opens a call or an index is marked so it can no longer look like a bare identifier. That
 * keeps argument lists (`fn(a, b, c)`), calls (`{ doWork() }`) and nested values
 * (`{ a: { b: 1 }, file }`) from contributing names, while `{ ...rest, file }` still yields
 * `file` because `...rest` is not an identifier on its own.
 */
function collectShorthandPropertyNames(body: string, into: Set<string>): void {
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '{') continue

    const objectEnd = findMatchingClose(body, i)
    if (objectEnd === -1) continue

    const segments: string[] = []
    let current = ''
    let depth = 0

    for (let k = i; k < objectEnd; k++) {
      const char = body[k]
      if (char === '{' || char === '[' || char === '(') {
        depth++
        if (depth === 2) current += '#'
        continue
      }
      if (char === '}' || char === ']' || char === ')') {
        depth--
        continue
      }
      if (depth !== 1) continue
      if (char === ',') {
        segments.push(current)
        current = ''
        continue
      }
      current += char
    }
    segments.push(current)

    for (const segment of segments) {
      const name = segment.trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) into.add(name)
    }
  }
}

/**
 * Collects the tool-param names a block's own `tools.config.params` mapper writes.
 *
 * A block can supply a hidden tool param without ever declaring a subBlock of that name:
 * Cal.com assembles `result.attendee` from `attendeeName`/`attendeeEmail`/`attendeeTimeZone`,
 * JSM renames its `assetWorkspaceId` field to `workspaceId`, and Textract renames its
 * `document` field to `file`. All are user-driven and must stay documented, so this scan
 * catches both shapes — `<anyIdentifier>.<param> = …` assignments (the accumulator is named
 * `result` in one block and `parameters` in another, so the name is never assumed) and
 * `<param>:` keys of the objects the mapper returns.
 *
 * The rule is deliberately biased toward keeping. Object keys are collected without proving
 * they are top-level params, so a key on a nested object (Cal.com's `attendee.name`) can keep
 * a same-named hidden param that the mapper never actually supplies. That false keep costs a
 * reader one hard-to-set row; a false drop hides a required input — the exact failure this
 * filter exists to prevent, and one it has already caused. When the two are in tension, keep.
 *
 * Scanning runs on the blanked copy, so a commented-out or string-embedded mapper cannot
 * contribute names.
 */
export function extractMapperWrittenParamIds(blockContent: string): string[] {
  const scannable = blankStringsAndComments(blockContent)
  if (scannable === null) return []
  const ids = new Set<string>()

  for (const [start, end] of findMapperBodyRanges(scannable)) {
    const body = scannable.slice(start, end)

    const assignmentRegex = /(?:^|[^.\w$])[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)\s*=(?!=)/g
    let match: RegExpExecArray | null
    while ((match = assignmentRegex.exec(body)) !== null) ids.add(match[1])

    const keyRegex = /(?:^|[^?.\w$])([A-Za-z_$][\w$]*)\s*:/g
    while ((match = keyRegex.exec(body)) !== null) ids.add(match[1])

    /**
     * Quoted keys survive blanking only as their delimiters, so the name is read back from
     * the original content at the same index — `blankStringsAndComments` is length-preserving.
     */
    const quotedKeyRegex = /(['"])[^'"\n]*\1\s*:/g
    while ((match = quotedKeyRegex.exec(body)) !== null) {
      const keyStart = start + match.index
      const original = blockContent.slice(keyStart, keyStart + match[0].length)
      const name = /(['"])([A-Za-z_$][\w$]*)\1/.exec(original)?.[2]
      if (name) ids.add(name)
    }

    /**
     * A computed write (`result['file'] = …`) supplies a param exactly as `result.file = …`
     * does. Like the quoted keys above, the name only survives blanking as its delimiters and
     * is read back from the original content at the matched index.
     */
    const bracketAssignmentRegex =
      /(?:^|[^.\w$])[A-Za-z_$][\w$]*\s*\[\s*(['"])[^'"\n]*\1\s*\]\s*=(?!=)/g
    while ((match = bracketAssignmentRegex.exec(body)) !== null) {
      const matchStart = start + match.index
      const original = blockContent.slice(matchStart, matchStart + match[0].length)
      const name = /\[\s*(['"])([A-Za-z_$][\w$]*)\1\s*\]/.exec(original)?.[2]
      if (name) ids.add(name)
    }

    collectShorthandPropertyNames(body, ids)
  }

  return [...ids]
}

/** What {@link extractBlockSuppliedParamIds} could and could not read off a block. */
export interface BlockSuppliedParams {
  /**
   * Every param the block supplies, or `null` when what its `subBlocks` array contributes is
   * unknown — either the array could not be read (`parseError` set) or it holds only spreads of
   * fields arrays this scanner cannot follow (`parseError` null).
   *
   * `null` is UNKNOWN and is deliberately distinct from `[]`: an empty array asserts the block
   * supplies nothing, which strips every hidden param from the page, while `null` says the scan
   * failed and the filter must be skipped entirely for this block.
   */
  ids: string[] | null
  /**
   * The params the block's `tools.config.params` mapper writes. Collected even when the
   * `subBlocks` scan failed, so a spread-inheriting block does not lose its mapper's renames
   * along with its own fields.
   */
  mapperIds: string[]
  /** Why the `subBlocks` scan failed, when it did. `null` on success. */
  parseError: string | null
}

/**
 * Every param name the block itself supplies — via a user-facing `subBlocks` field or via
 * its `tools.config.params` mapper. A hidden tool param in this set stays in the public
 * Input table; the rest are genuinely resolver-derived and stay filtered out.
 *
 * An unreadable `subBlocks` array is reported as `ids: null` rather than thrown, because the
 * only safe response to "the fields are unknown" is to stop filtering, never to filter against
 * an empty set. The mapper scan runs first so its result survives that failure.
 */
export function extractBlockSuppliedParamIds(
  blockContent: string,
  blockName = 'block'
): BlockSuppliedParams {
  /**
   * A source the blanking scanner cannot get through — it ends inside an unterminated string,
   * template literal or comment — makes both scans below report "nothing found" for the same
   * reason. It is caught here so it is reported as a parse failure. Left to the branches below
   * it would be indistinguishable from a spread-only `subBlocks` array whose block has no
   * mapper, and the block's renames would be dropped without a word.
   */
  if (blankStringsAndComments(blockContent) === null) {
    return {
      ids: null,
      mapperIds: [],
      parseError: `${blockName}: source ends inside an unterminated string, template literal or comment, so neither its subBlocks array nor its params mapper could be read`,
    }
  }

  const mapperIds = extractMapperWrittenParamIds(blockContent)

  try {
    const settableIds = extractUserSettableParamIds(blockContent, blockName)
    if (settableIds === null) return { ids: null, mapperIds, parseError: null }
    return { ids: [...new Set([...settableIds, ...mapperIds])], mapperIds, parseError: null }
  } catch (error) {
    if (!(error instanceof SubBlockParseError)) throw error
    return { ids: null, mapperIds, parseError: error.message }
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
    const toolFiles = await sourceGlob(`${toolsDir}/**/*.ts`)
    for (const file of toolFiles) {
      const basename = path.basename(file)
      if (basename === 'index.ts' || basename === 'types.ts') continue
      const content = readSourceFile(file)

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
        // Match against the actual opening quote so apostrophes inside a
        // double-quoted description (e.g. "Find someone's email") are preserved
        // rather than being treated as the closing quote and truncating the value.
        const descMatch = searchWindow.match(
          /\bdescription\s*:\s*(?:'([^']{5,})'|"([^"]{5,})"|`([^`]{5,})`)/
        )
        const nameMatch = searchWindow.match(/\bname\s*:\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)/)
        if (descMatch) desc.set(toolId, descMatch[1] ?? descMatch[2] ?? descMatch[3] ?? '')
        if (nameMatch) name.set(toolId, nameMatch[1] ?? nameMatch[2] ?? nameMatch[3] ?? '')
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
  if (/authMode\s*:\s*AuthMode\.OAuth\b/.test(blockContent)) return 'oauth'
  if (/authMode\s*:\s*AuthMode\.(?:ApiKey|BotToken)\b/.test(blockContent)) return 'api-key'
  // Fall back to credential subBlock heuristics for blocks without authMode.
  if (/type\s*:\s*['"]oauth-input['"]/.test(blockContent)) return 'oauth'
  if (/\bid\s*:\s*['"](?:apiKey|api_key|accessToken)['"]/.test(blockContent)) return 'api-key'
  return 'none'
}

/**
 * The catalog and every generated mapping are sorted with an explicit `en-US` collation.
 * `localeCompare` with no locale uses the runtime default, which varies with `LANG` and the
 * ICU build: `tr-TR`, `lt-LT`, `cs-CZ` and `et-EE` each reorder the real integration names, so
 * a contributor on one of those locales would regenerate a different artifact and fail CI with
 * no obvious cause.
 */
function compareCatalogNames(a: string, b: string): number {
  return a.localeCompare(b, 'en-US')
}

/**
 * Characters after which a `/` begins a regex literal rather than a division.
 *
 * `'\n'` is deliberate and load-bearing: a line-leading `/` is treated as opening a regex.
 * A newline is recorded as the previous significant character rather than skipped, so this
 * entry — not the `(` before it — is what decides a wrapped `value.match(` newline `/re/`.
 * Prettier and Biome both emit a binary `/` at end-of-line, never at the start of the next
 * one, so in this repo's formatted sources every line-leading `/` really is a regex, without
 * exception — `blocks/table.ts` and `blocks/table_v2.ts` both wrap a `.match(` argument this
 * way, and removing `'\n'` makes them lex as division and silently mis-scan. It is a
 * deliberate trade: a hand-wrapped `b` newline `/ c / d` would be blanked as a regex body,
 * which no formatted file in this repo produces.
 */
const REGEX_ALLOWED_AFTER = new Set([
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '/',
  '%',
  '~',
  '^',
  '<',
  '>',
  '\n',
])

/**
 * Keywords after which a `/` begins a regex literal rather than a division. In every one of
 * these positions an operand is expected, so `return /x/`, `typeof /x/` or `case /x/` opens a
 * regex — a check on the previous character alone reads the keyword's last letter as an
 * identifier and lexes the `/` as division.
 */
const REGEX_START_KEYWORDS = new Set([
  'return',
  'typeof',
  'case',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'instanceof',
  'do',
  'else',
  'yield',
  'await',
])

/**
 * Whether the word immediately before `index` is a {@link REGEX_START_KEYWORDS} keyword.
 * A property access (`counts.in / 2`) is excluded, since there the word is an identifier
 * and the `/` really is a division.
 */
function precededByRegexStartKeyword(content: string, index: number): boolean {
  let j = index - 1
  while (j >= 0 && /\s/.test(content[j])) j--
  const wordEnd = j + 1
  while (j >= 0 && /[A-Za-z0-9_$]/.test(content[j])) j--
  if (!REGEX_START_KEYWORDS.has(content.slice(j + 1, wordEnd))) return false
  return content[j] !== '.' && content[j] !== '#'
}

/** Index just past a `//` comment opening at `start`. */
function scanLineComment(content: string, start: number): number {
  const newline = content.indexOf('\n', start)
  return newline === -1 ? content.length : newline
}

/** Index just past the block comment opening at `start`, or null when it never closes. */
function scanBlockComment(content: string, start: number): number | null {
  const close = content.indexOf('*/', start + 2)
  return close === -1 ? null : close + 2
}

/** Index just past a regex literal (and its flags) opening at `start`, or null when unterminated. */
function scanRegexLiteral(content: string, start: number): number | null {
  let j = start + 1
  let inClass = false
  let closed = false
  while (j < content.length) {
    const c = content[j]
    if (c === '\\') {
      j += 2
      continue
    }
    if (c === '\n') break
    if (c === '[') inClass = true
    else if (c === ']') inClass = false
    else if (c === '/' && !inClass) {
      closed = true
      break
    }
    j++
  }
  if (!closed) return null
  j++
  while (j < content.length && /[a-z]/.test(content[j])) j++
  return j
}

/** Index OF the closing quote of the string opening at `start`, or null when unterminated. */
function scanQuoted(content: string, start: number): number | null {
  const quote = content[start]
  let j = start + 1
  while (j < content.length) {
    if (content[j] === '\\') {
      j += 2
      continue
    }
    if (content[j] === '\n') break
    if (content[j] === quote) return j
    j++
  }
  return null
}

/** Index OF the closing backtick of the template literal opening at `start`, or null. */
function scanTemplateLiteral(content: string, start: number): number | null {
  let j = start + 1
  while (j < content.length) {
    const c = content[j]
    if (c === '\\') {
      j += 2
      continue
    }
    if (c === '`') return j
    if (c === '$' && content[j + 1] === '{') {
      const end = scanTemplateExpression(content, j + 2)
      if (end === null) return null
      j = end
      continue
    }
    j++
  }
  return null
}

/**
 * Index just past the `}` that closes the `${` expression starting at `start`, or null.
 *
 * The expression is lexed with the same primitives as top-level code, so a brace inside a
 * nested string, comment, regex or template never counts toward the depth — a plain counter
 * loses the closing backtick of `` `${ f("}") }` `` and reports the whole block unreadable.
 */
function scanTemplateExpression(content: string, start: number): number | null {
  let j = start
  let depth = 0
  let prevSignificant = ''
  while (j < content.length) {
    const c = content[j]

    if (c === '/' && content[j + 1] === '/') {
      j = scanLineComment(content, j)
      continue
    }
    if (c === '/' && content[j + 1] === '*') {
      const end = scanBlockComment(content, j)
      if (end === null) return null
      j = end
      continue
    }
    if (c === '/' && startsRegexLiteral(content, j, prevSignificant)) {
      const end = scanRegexLiteral(content, j)
      if (end === null) return null
      prevSignificant = ')'
      j = end
      continue
    }
    if (c === "'" || c === '"') {
      const close = scanQuoted(content, j)
      if (close === null) return null
      prevSignificant = c
      j = close + 1
      continue
    }
    if (c === '`') {
      const close = scanTemplateLiteral(content, j)
      if (close === null) return null
      prevSignificant = '`'
      j = close + 1
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      if (depth === 0) return j + 1
      depth--
    }

    if (!/\s/.test(c)) prevSignificant = c
    else if (c === '\n') prevSignificant = '\n'
    j++
  }
  return null
}

/**
 * Whether the word immediately before `index` ends in a postfix `++` or `--`.
 * {@link REGEX_ALLOWED_AFTER} holds `'+'` and `'-'` for the binary operators, but a postfix
 * increment produces a value, so the `/` in `i++ / a` is a division. Only the two-character
 * form is matched — a single `+`/`-` stays an operator position.
 */
function precededByPostfixUpdate(content: string, index: number): boolean {
  let j = index - 1
  while (j >= 0 && /\s/.test(content[j])) j--
  const c = content[j]
  return (c === '+' || c === '-') && content[j - 1] === c
}

/** Whether the `/` at `index` opens a regex literal rather than a division. */
function startsRegexLiteral(content: string, index: number, prevSignificant: string): boolean {
  if (
    (prevSignificant === '+' || prevSignificant === '-') &&
    precededByPostfixUpdate(content, index)
  )
    return false
  return (
    prevSignificant === '' ||
    REGEX_ALLOWED_AFTER.has(prevSignificant) ||
    precededByRegexStartKeyword(content, index)
  )
}

/**
 * Blank out string literals, template literals, comments and regex literals so a structural
 * scan sees only code punctuation. Length and newlines are preserved, which the `readLiteral`
 * index-mapping call sites depend on.
 *
 * Quoted strings keep their delimiters so callers can still see where one began; comments and
 * regex literals are blanked whole, because their final character is arbitrary source text —
 * commented-out code ending in `[`, or a character class like `/[}]/`, otherwise leaves an
 * unbalanced bracket that derails every downstream scan.
 *
 * Returns `null` when the scan ends inside an unterminated construct, which means the input
 * was not what we assumed and no structural conclusion drawn from it can be trusted.
 */
function blankStringsAndComments(content: string): string | null {
  const out = content.split('')
  const blank = (start: number, end: number) => {
    for (let k = start; k < end && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '
  }

  let i = 0
  let prevSignificant = ''
  while (i < content.length) {
    const char = content[i]

    if (char === '/' && content[i + 1] === '/') {
      const end = scanLineComment(content, i)
      blank(i, end)
      i = end
      continue
    }

    if (char === '/' && content[i + 1] === '*') {
      const end = scanBlockComment(content, i)
      if (end === null) return null
      blank(i, end)
      i = end
      continue
    }

    if (char === '/' && startsRegexLiteral(content, i, prevSignificant)) {
      const end = scanRegexLiteral(content, i)
      if (end === null) return null
      blank(i, end)
      prevSignificant = ')'
      i = end
      continue
    }

    if (char === "'" || char === '"') {
      const close = scanQuoted(content, i)
      if (close === null) return null
      blank(i + 1, close)
      prevSignificant = char
      i = close + 1
      continue
    }

    if (char === '`') {
      const close = scanTemplateLiteral(content, i)
      if (close === null) return null
      blank(i + 1, close)
      prevSignificant = '`'
      i = close + 1
      continue
    }

    if (!/\s/.test(char)) prevSignificant = char
    else if (char === '\n') prevSignificant = '\n'
    i++
  }

  return out.join('')
}

/**
 * Extract the OAuth service id from the block's `oauth-input` credential
 * subBlock. Scoped to that subBlock's object literal so `serviceId` fields on
 * other subBlocks (e.g. file selectors) are never picked up. Brace matching
 * runs on a blanked copy of the content so string literals and comments
 * containing braces cannot skew it.
 */
function extractOAuthServiceId(blockContent: string): string | undefined {
  const typeMatch = /type\s*:\s*['"]oauth-input['"]/.exec(blockContent)
  if (!typeMatch) return undefined

  const scannable = blankStringsAndComments(blockContent)
  if (scannable === null) return undefined
  let depth = 0
  let objectStart = -1
  for (let i = typeMatch.index; i >= 0; i--) {
    const char = scannable[i]
    if (char === '}') depth++
    else if (char === '{') {
      if (depth === 0) {
        objectStart = i
        break
      }
      depth--
    }
  }
  if (objectStart === -1) return undefined

  const objectEnd = findMatchingClose(scannable, objectStart)
  if (objectEnd === -1) return undefined
  const subBlockContent = blockContent.substring(objectStart, objectEnd)
  return /serviceId\s*:\s*['"]([^'"]+)['"]/.exec(subBlockContent)?.[1]
}

/**
 * Extract the list of trigger IDs from the block's `triggers.available` array.
 * Handles blocks that declare `triggers: { enabled: true, available: [...] }`.
 */
function extractTriggersAvailable(blockContent: string, fileContent?: string): string[] {
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

  // Blocks like emailbison declare `available: [...LOCAL_TRIGGER_IDS]`;
  // resolve same-file const spreads to their literal entries so those
  // triggers are not silently dropped from the generated data.
  let resolvedContent = arrayContent
  const constSource = fileContent ?? blockContent
  const spreadRegex = /\.\.\.(\w+)/g
  let spreadMatch: RegExpExecArray | null
  while ((spreadMatch = spreadRegex.exec(arrayContent)) !== null) {
    const constMatch = new RegExp(`const\\s+${spreadMatch[1]}\\s*=\\s*\\[`).exec(constSource)
    if (!constMatch) continue
    const constStart = constMatch.index + constMatch[0].length - 1
    const constEnd = findMatchingClose(constSource, constStart, '[', ']')
    if (constEnd === -1) continue
    resolvedContent += constSource.substring(constStart + 1, constEnd - 1)
  }

  const ids: string[] = []
  const idRegex = /['"]([^'"]+)['"]/g
  let m
  while ((m = idRegex.exec(resolvedContent)) !== null) {
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

  const triggerFiles = (await sourceGlob(`${TRIGGERS_PATH}/**/*.ts`)).filter(
    (f) => !SKIP.has(path.basename(f)) && !f.includes('.test.')
  )

  for (const file of triggerFiles) {
    try {
      const content = readSourceFile(file)

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

        // Deprecated triggers stay registered for existing workflows but are
        // excluded from generated documentation.
        if (/\bdeprecated\s*:\s*true/.test(segment)) continue

        if (idMatch && nameMatch) {
          registry.set(idMatch[1], {
            id: idMatch[1],
            name: nameMatch[1],
            description: descMatch?.[1] ?? '',
          })
        }
      }

      const evaluatedTriggers = await loadTriggerRegistry()
      const factoryExportRegex =
        /export\s+const\s+\w+(?:\s*:\s*TriggerConfig)?\s*=\s*\w+\s*\(\s*['"]([^'"]+)['"]/g
      let factoryExportMatch: RegExpExecArray | null
      while ((factoryExportMatch = factoryExportRegex.exec(content)) !== null) {
        const trigger = evaluatedTriggers[factoryExportMatch[1]]
        if (!trigger?.id || !trigger.name || trigger.deprecated || registry.has(trigger.id)) {
          continue
        }

        registry.set(trigger.id, {
          id: trigger.id,
          name: trigger.name,
          description: trigger.description ?? '',
        })
      }
    } catch {
      // skip unreadable files silently
    }
  }

  console.log(`✓ Loaded ${registry.size} trigger definitions`)
  return registry
}

/**
 * Write the icon mapping TypeScript file for the shared integrations data
 * directory (`apps/sim/lib/integrations`). Mirrors `writeIconMapping` (the
 * docs-app variant) but targets the sim app so it imports from
 * `@/components/icons`. Unlike the docs variant, no bare-name aliasing is
 * applied because consumers always look up by the canonical (possibly
 * versioned) `integration.type` emitted into `integrations.json`.
 */
function writeIntegrationsIconMapping(iconMapping: Record<string, IconRef>): void {
  try {
    if (!fs.existsSync(INTEGRATIONS_DATA_PATH)) {
      fs.mkdirSync(INTEGRATIONS_DATA_PATH, { recursive: true })
    }
    const iconMappingPath = path.join(INTEGRATIONS_DATA_PATH, 'icon-mapping.ts')

    const imports = renderIconImports(Object.values(iconMapping))
    const mappingEntries = Object.entries(iconMapping)
      .sort(([a], [b]) => compareCatalogNames(a, b))
      .map(([blockType, iconRef]) => `  ${formatIconMapKey(blockType)}: ${iconRef.name},`)
      .join('\n')

    const content = `// Auto-generated file - do not edit manually
// Generated by scripts/generate-docs.ts
// Maps block types to their icon component references for the integrations page

import type { ComponentType, SVGProps } from 'react'
${imports}

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

export const blockTypeToIconMap: Record<string, IconComponent> = {
${mappingEntries}
}
`
    emitGeneratedFile(iconMappingPath, content)
    if (!CHECK_ONLY) console.log('✓ Integration icon mapping written')
  } catch (error) {
    console.error('Error writing integration icon mapping:', error)
  }
}

/**
 * Collect all integration entries from block definitions and write integrations.json
 * to the shared integrations data directory (`apps/sim/lib/integrations`).
 * Applies the same visibility filters as the docs generation pipeline.
 */
async function writeIntegrationsJson(iconMapping: Record<string, IconRef>): Promise<void> {
  try {
    if (!fs.existsSync(INTEGRATIONS_DATA_PATH)) {
      fs.mkdirSync(INTEGRATIONS_DATA_PATH, { recursive: true })
    }

    const triggerRegistry = await buildTriggerRegistry()
    const { desc: toolDescMap, name: toolNameMap } = await buildToolDescriptionMap()

    // Hand-authored, integration-specific landing content (install walkthrough,
    // privacy blurb), keyed by slug. Imported as pure data — its only import is
    // type-only and erased at runtime — and baked into the entries below so the
    // landing page reads a single source instead of augmenting at render time.
    const landingContentModule = await import(
      pathToFileURL(path.join(LANDING_INTEGRATIONS_DATA_PATH, 'landing-content.ts')).href
    )
    const landingContentMap = (landingContentModule.INTEGRATION_LANDING_CONTENT ?? {}) as Record<
      string,
      Record<string, unknown>
    >

    const integrations: IntegrationEntry[] = []
    const seenBaseTypes = new Set<string>()
    const blockFiles = (await sourceGlob(`${BLOCKS_PATH}/*.ts`)).sort()

    for (const blockFile of blockFiles) {
      const fileContent = readSourceFile(blockFile)
      const switchCaseMap = extractSwitchCaseToolMapping(fileContent)
      const configs = blockConfigsForFile(blockFile)

      for (const config of configs) {
        const blockType = config.type

        // Canonical integrations filter: only third-party tool blocks visible in the toolbar.
        // `isIntegrationBlock` is the single source of truth for "is integration".
        if (!isIntegrationBlock(config)) continue

        // Every tools-category block MUST declare an `integrationType` from the canonical
        // 16-value enum (apps/sim/blocks/types.ts). Fail loudly so the catalog never
        // ships a tool without a category bucket.
        if (!config.integrationType) {
          throw new Error(
            `Block "${blockType}" has \`category: 'tools'\` but is missing required \`integrationType\`. ` +
              `Add one of the IntegrationType values from apps/sim/blocks/types.ts.`
          )
        }
        if (!INTEGRATION_CATEGORY_VALUES.has(config.integrationType as IntegrationType)) {
          throw new Error(
            `Block "${blockType}" has unrecognised \`integrationType: "${config.integrationType}"\`. ` +
              `Use one of: ${[...INTEGRATION_CATEGORY_VALUES].join(', ')}.`
          )
        }
        const integrationType = config.integrationType as IntegrationType

        const baseType = stripVersionSuffix(blockType)
        if (seenBaseTypes.has(baseType)) continue
        seenBaseTypes.add(baseType)

        const iconName = (config as any).iconName || iconMapping[blockType]?.name || ''
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
        const docsUrl = (config as any).docsLink || defaultIntegrationDocsUrl(baseType)

        const slug = config.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')

        const authType = extractAuthType(fileContent)
        const oauthServiceId = authType === 'oauth' ? extractOAuthServiceId(fileContent) : undefined
        // OAuth integrations resolve their connect UI through the service id
        // (see `resolveOAuthServiceForIntegration`), so fail loudly rather than
        // shipping a catalog entry that silently falls back to the API-key path.
        if (authType === 'oauth' && !oauthServiceId) {
          throw new Error(
            `Block "${blockType}" is an OAuth integration but no \`serviceId\` could be ` +
              `extracted from its \`oauth-input\` subBlock.`
          )
        }

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
          ...(oauthServiceId ? { oauthServiceId } : {}),
          category: 'tools',
          integrationType,
          ...(config.tags ? { tags: config.tags } : {}),
          ...(landingContentMap[slug] ? { landingContent: landingContentMap[slug] } : {}),
        })
      }
    }

    integrations.sort((a, b) => compareCatalogNames(a.name, b.name))

    const jsonPath = path.join(INTEGRATIONS_CATALOG_PATH, 'integrations.json')
    // `JSON.stringify` always expands every array across multiple lines, but Biome's
    // JSON formatter inlines short arrays of primitive strings. Pre-collapse those
    // arrays here so the emitted file is already in Biome's canonical shape and
    // `bun run check` does not churn it on every commit.
    const serialize = (value: unknown) =>
      JSON.stringify(value, null, 2).replace(
        /\[\n(\s+"[^"\n]*"(?:,\n\s+"[^"\n]*")*)\n\s+\]/g,
        (_match, inner) => {
          const items = (inner as string).split(',\n').map((s: string) => s.trim())
          return `[${items.join(', ')}]`
        }
      )

    // `updatedAt` is re-stamped only when the integrations content actually
    // changes, so sitemap/JSON-LD freshness never churns on no-op regens.
    const previous = fs.existsSync(jsonPath)
      ? (JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as { integrations?: unknown })
      : null
    if (previous?.integrations && serialize(previous.integrations) === serialize(integrations)) {
      console.log(`✓ Integration data unchanged: ${integrations.length} integrations → ${jsonPath}`)
      return
    }

    if (CHECK_ONLY) {
      staleArtifacts.push(path.relative(rootDir, jsonPath))
      return
    }

    const updatedAt = new Date().toISOString().slice(0, 10)
    fs.writeFileSync(jsonPath, `${serialize({ updatedAt, integrations })}\n`)
    console.log(`✓ Integration data written: ${integrations.length} integrations → ${jsonPath}`)
  } catch (error) {
    // Surface taxonomy violations (missing/invalid `integrationType`) loudly —
    // they are programmer errors that must fail the generator, not be logged
    // and silently swallowed.
    console.error('Error writing integrations JSON:', error)
    throw error
  }
}

/**
 * Extract ALL block configs from a file, filtering out hidden blocks
 */
export function extractAllBlockConfigs(fileContent: string): BlockConfig[] {
  const configs: BlockConfig[] = []

  // First, extract the primary icon from the file (for V2 blocks that inherit via spread)
  const primaryIcon = extractIconNameFromContent(fileContent)

  const exportRegex = /export\s+const\s+(\w+)Block\s*:\s*BlockConfig[^=]*=\s*\{/g
  let match

  while ((match = exportRegex.exec(fileContent)) !== null) {
    const blockName = match[1]
    const startIndex = match.index + match[0].length - 1 // Position of opening brace

    const endIndex = findMatchingClose(fileContent, startIndex)

    if (endIndex !== -1) {
      const blockContent = fileContent.substring(startIndex, endIndex)

      const hideFromToolbar = /hideFromToolbar\s*:\s*true/.test(stripSourceComments(blockContent))
      if (hideFromToolbar) {
        console.log(`Skipping ${blockName}Block - hideFromToolbar is true`)
        continue
      }

      // Unreleased preview blocks stay out of every generated surface: docs
      // .mdx pages, integrations.json (landing + workspace catalog + sitemap +
      // OG images), and the icon mapping.
      if (isPreviewSource(blockContent)) {
        console.log(`Skipping ${blockName}Block - preview is true`)
        continue
      }

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

/** Resolves a block's category through local spread ancestry without loading its registry. */
export function extractInheritedBlockCategory(
  blockContent: string,
  fileContent: string
): string | null {
  const visited = new Set<string>()
  let current = blockContent
  while (true) {
    const category = extractStringPropertyFromContent(current, 'category', true)
    if (category) return category
    const base = extractSpreadBase(current)
    if (!base || visited.has(base)) return null
    visited.add(base)
    const declaration = new RegExp(
      `export\\s+const\\s+${base}\\s*:\\s*BlockConfig[^=]*=\\s*\\{`
    ).exec(fileContent)
    if (!declaration) return null
    const start = declaration.index + declaration[0].length - 1
    const end = findMatchingClose(fileContent, start)
    if (end === -1) return null
    current = fileContent.substring(start, end)
  }
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
    const spreadBase = extractSpreadBase(blockContent)
    let baseConfig: BlockConfig | null = null

    if (spreadBase && fileContent) {
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
      extractStringPropertyFromContent(blockContent, 'category', true) || baseConfig?.category || ''
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
        const versionSuffix = `_v${mapMatch[1]}`
        finalToolsAccess = baseConfig.tools.access.map((tool) => `${tool}${versionSuffix}`)
      }
    }

    const operations = extractOperationsFromContent(blockContent)
    const triggerIds = extractTriggersAvailable(blockContent, fileContent)
    const supplied = extractBlockSuppliedParamIds(blockContent, blockName)
    /**
     * `null` on the base means the base's own scan failed, which is not the same as a block
     * with no base at all (`undefined`) — the fields the base contributes are unknown, so
     * anything inheriting them is unknown too.
     */
    const baseParamIds: string[] | null | undefined = (baseConfig as any)?.userSettableParamIds
    const baseSettableParamIds: string[] = baseParamIds ?? []

    /**
     * `null` means UNKNOWN and disables the hidden-param filter for this block, restoring the
     * pre-filter behaviour of documenting every param. An unreadable `subBlocks` array must
     * never be collapsed into `[]`, because `[]` asserts the block supplies nothing and strips
     * every hidden param from the page, and it must never abort the run either — one block the
     * scanner cannot read used to brick the generator for the entire repository.
     */
    let userSettableParamIds: string[] | null
    if (supplied.parseError !== null) {
      /**
       * A block that spreads a base still documents the base's fields, so the filter can stay
       * on and lose at most the fields this block adds on top of the base — plus its mapper's
       * renames, which are read even when the `subBlocks` scan fails. With no base to fall back
       * on there is nothing to filter against, so the filter is switched off entirely.
       */
      const fallback =
        baseSettableParamIds.length > 0
          ? [...new Set([...baseSettableParamIds, ...supplied.mapperIds])]
          : null
      if (!subBlockParseWarnings.has(supplied.parseError)) {
        subBlockParseWarnings.add(supplied.parseError)
        console.warn(
          `⚠ ${supplied.parseError}; ${
            fallback
              ? "documenting the spread base's fields instead"
              : 'documenting every param of its tools instead of filtering'
          }`
        )
      }
      userSettableParamIds = fallback
    } else if (baseParamIds === null) {
      userSettableParamIds = null
    } else if (supplied.ids === null) {
      /**
       * With `parseError` null, the only remaining cause is a `subBlocks` array holding just
       * spreads of fields arrays this scanner cannot follow — a source the scanner could not
       * get through at all is reported as a `parseError` by `extractBlockSuppliedParamIds` and
       * handled above. A config-level spread base still contributes its readable fields, so the
       * filter stays on against those plus the mapper's renames; with no base there is nothing
       * to filter against and the filter is switched off. No warning: the array itself parsed
       * fine, and every field it names is documented through the spread source's own page.
       */
      userSettableParamIds =
        baseSettableParamIds.length > 0
          ? [...new Set([...baseSettableParamIds, ...supplied.mapperIds])]
          : null
    } else {
      userSettableParamIds = [...new Set([...supplied.ids, ...baseSettableParamIds])]
    }
    const docsLink =
      extractStringPropertyFromContent(blockContent, 'docsLink', true) ||
      baseConfig?.docsLink ||
      defaultIntegrationDocsUrl(blockType)

    const integrationType =
      extractEnumPropertyFromContent(blockContent, 'integrationType') ||
      baseConfig?.integrationType ||
      null
    // Tags live on the block's `<BlockName>BlockMeta` export. For spread-inheriting
    // blocks (e.g. `ConfluenceV2Block` extending `ConfluenceBlock`), also try the
    // spread base's meta so V2 variants inherit tags.
    const tags =
      (fileContent ? extractTagsFromBlockMeta(fileContent, blockName) : null) ||
      (fileContent && spreadBase
        ? extractTagsFromBlockMeta(fileContent, spreadBase.replace(/Block$/, ''))
        : null)

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
      userSettableParamIds,
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
 * The single predicate that decides whether an extracted block config belongs
 * in the integration surfaces emitted by this script — the integrations
 * catalog (`integrations.json`) and the per-tool `/tools/*.mdx` docs. A block
 * qualifies only when it is a third-party integration (`category: 'tools'`)
 * that is currently surfaced in the toolbar (`hideFromToolbar` not set). Under
 * the versioning upgrade paradigm only the latest version is visible, so this
 * also naturally selects the canonical version. Recategorizing a block to
 * `'blocks'` or `'triggers'` removes it from all integration surfaces.
 */
function isIntegrationBlock(config: {
  category?: string
  hideFromToolbar?: boolean
  preview?: boolean
}): boolean {
  return config.category === 'tools' && !config.hideFromToolbar && !config.preview
}

/**
 * Block types that never belong in the integrations icon map regardless of
 * category — core primitives, triggers, and webhook/feed plumbing.
 */
const ICON_MAP_EXCLUDED_TYPES = new Set([
  'evaluator',
  'number',
  'webhook',
  'schedule',
  'mcp',
  'generic_webhook',
  'rss',
])

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
 * Extract an enum property value from block content. Maps an `IntegrationType`
 * enum key (e.g. `Communication`) to its slug value (e.g. `'communication'`).
 * Mirrors `apps/sim/blocks/types.ts → IntegrationType` — keep in sync.
 */
function extractEnumPropertyFromContent(content: string, propName: string): string | null {
  const match = content.match(new RegExp(`${propName}\\s*:\\s*IntegrationType\\.(\\w+)`))
  if (!match) return null
  const enumKey = match[1]
  const ENUM_MAP: Record<string, string> = {
    AI: 'ai',
    Analytics: 'analytics',
    Commerce: 'commerce',
    Communication: 'communication',
    Databases: 'databases',
    DevOps: 'devops',
    Documents: 'documents',
    Email: 'email',
    HR: 'hr',
    Marketing: 'marketing',
    Observability: 'observability',
    Productivity: 'productivity',
    Sales: 'sales',
    Search: 'search',
    Security: 'security',
    Support: 'support',
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

/**
 * Extract `tags` from a `<BlockName>BlockMeta` literal in the source file.
 * Looks for `export const <BlockName>BlockMeta = { ... tags: [...] ... }`
 * at file scope and scans only the body of that literal. Returns null when
 * no matching meta export exists or it contains no `tags` array.
 *
 * During the in-progress migration to per-block meta, some blocks declare
 * `tags` on `BlockConfig` and others on `*BlockMeta`. The caller should
 * try this extractor first and fall back to the `BlockConfig` extractor.
 */
function extractTagsFromBlockMeta(fileContent: string, blockName: string): string[] | null {
  const headerRegex = new RegExp(`export\\s+const\\s+${blockName}BlockMeta\\s*(?::[^=]+)?=\\s*\\{`)
  const metaHeaderMatch = fileContent.match(headerRegex)
  if (!metaHeaderMatch || metaHeaderMatch.index === undefined) return null
  const openBracePos = fileContent.indexOf('{', metaHeaderMatch.index)
  if (openBracePos === -1) return null
  const closeBracePos = findMatchingClose(fileContent, openBracePos)
  if (closeBracePos === -1) return null
  const metaBody = fileContent.substring(openBracePos + 1, closeBracePos)
  return extractArrayPropertyFromContent(metaBody, 'tags')
}

/**
 * Extract the component identifier assigned to a block's `icon` property.
 * Most block icons are named `<Service>Icon`, but some reference a generic emcn
 * icon (e.g. `icon: Library`) or use a lowercase identifier (`icon: xIcon`), so
 * this matches any identifier rather than requiring the `Icon` suffix. Bare JS
 * literals are excluded so `icon: undefined` never resolves to a component.
 */
function extractIconNameFromContent(content: string): string | null {
  const iconMatch = content.match(
    /(?:^|[\s{,])icon\s*:\s*(?!(?:undefined|null|true|false)\b)([A-Za-z_$][\w$]*)/
  )
  return iconMatch ? iconMatch[1] : null
}

/** Module an icon component is imported from, when the block file declares it. */
const DEFAULT_ICON_SOURCE = '@/components/icons'

/**
 * Resolve the module a block's icon identifier is imported from by scanning the
 * block file's import statements. Falls back to `@/components/icons`, which is
 * where the overwhelming majority of block icons live and which both the sim
 * app and the docs app (via the copied `icons.tsx`) resolve.
 */
function resolveIconSource(fileContent: string, iconName: string): string {
  const importRegex = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = importRegex.exec(fileContent)) !== null) {
    const named = match[1].split(',').map((entry) =>
      entry
        .trim()
        .split(/\s+as\s+/)[0]
        .trim()
    )
    if (named.includes(iconName)) return match[2]
  }
  return DEFAULT_ICON_SOURCE
}

/** Biome's configured `formatter.lineWidth` for this repo. */
const BIOME_LINE_WIDTH = 100

/**
 * Quote an icon-map key that is not a bare JS identifier. Trigger providers use
 * hyphenated ids (`google-drive`, `microsoft-teams`) that would otherwise emit
 * as a subtraction expression and break the generated module.
 */
function formatIconMapKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`
}

/**
 * Render grouped `import { ... } from '...'` statements for every icon
 * referenced by a mapping, so icons sourced outside `@/components/icons`
 * (e.g. `@sim/emcn/icons`) resolve in the generated file. Output is emitted
 * pre-formatted — package specifiers before `@/` aliases, specifiers sorted,
 * and collapsed to one line when it fits — because these files are written
 * verbatim and never passed through Biome.
 */
function renderIconImports(iconRefs: IconRef[]): string {
  const bySource = new Map<string, Set<string>>()
  for (const ref of iconRefs) {
    let names = bySource.get(ref.source)
    if (!names) {
      names = new Set()
      bySource.set(ref.source, names)
    }
    names.add(ref.name)
  }
  const isAlias = (source: string) => source.startsWith('@/') || source.startsWith('.')
  return [...bySource.entries()]
    .sort(([a], [b]) => Number(isAlias(a)) - Number(isAlias(b)) || biomeSortCompare(a, b))
    .map(([source, names]) => {
      const sorted = [...names].sort(biomeSortCompare)
      const singleLine = `import { ${sorted.join(', ')} } from '${source}'`
      if (singleLine.length <= BIOME_LINE_WIDTH) return singleLine
      const specifiers = sorted.map((name) => `  ${name},`).join('\n')
      return `import {\n${specifiers}\n} from '${source}'`
    })
    .join('\n')
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
  const toolsMatch = /\btools\s*:\s*\{/.exec(content)
  if (!toolsMatch) return []

  const toolsStart = toolsMatch.index + toolsMatch[0].lastIndexOf('{')
  const toolsEnd = findMatchingClose(content, toolsStart)
  if (toolsEnd === -1) return []

  const toolsContent = content.substring(toolsStart, toolsEnd)
  const accessMatch = toolsContent.match(/access\s*:\s*\[\s*([^\]]+)\s*\]/)
  if (!accessMatch) return []
  return [...accessMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])
}

/**
 * Get the tool prefix (service name) from a tool name.
 * e.g., "calcom_list_schedules" -> "calcom"
 */
function getToolPrefixFromName(toolName: string): string {
  const parts = toolName.split('_')

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
  if (depth > 10) {
    console.warn(`Max recursion depth reached resolving const: ${constName}`)
    return null
  }

  const cacheKey = `${toolPrefix}:${constName}`
  if (constResolutionCache.has(cacheKey)) {
    return constResolutionCache.get(cacheKey)!
  }

  const typesFilePath = path.join(rootDir, `apps/sim/tools/${toolPrefix}/types.ts`)
  if (!fs.existsSync(typesFilePath)) {
    return null
  }

  const typesContent = readSourceFile(typesFilePath)

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

  constResolutionCache.set(cacheKey, properties)

  return properties
}

/**
 * Parse properties from a const definition, resolving nested const references.
 */
export function parseConstProperties(
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

    const beforeMatch = content.substring(0, spreadMatch.index)
    const openBraces = (beforeMatch.match(/\{/g) || []).length
    const closeBraces = (beforeMatch.match(/\}/g) || []).length
    if (openBraces !== closeBraces) {
      continue
    }

    const resolvedConst = resolveConstFromTypesContent(constName, typesContent, toolPrefix, depth)
    if (resolvedConst && typeof resolvedConst === 'object') {
      Object.assign(properties, resolvedConst)
    }
  }

  const propRegex = /(\w+)\s*:\s*(?:\{|([A-Z][A-Z_0-9]+)(?:\s*,|\s*$))/g
  let match

  while ((match = propRegex.exec(content)) !== null) {
    const propName = match[1]
    const constRef = match[2]

    const beforeMatch = content.substring(0, match.index)
    const openBraces = (beforeMatch.match(/\{/g) || []).length
    const closeBraces = (beforeMatch.match(/\}/g) || []).length
    if (openBraces !== closeBraces) {
      continue // Skip - this is a nested property
    }

    // For 'properties' or 'type', check if it's an output field definition vs a keyword
    // Output field definitions have 'type:' inside (e.g., { type: 'string', description: '...' })
    if ((propName === 'properties' || propName === 'type') && !constRef) {
      const startPos = match.index + match[0].length - 1
      const endPos = findMatchingClose(content, startPos)
      if (endPos !== -1) {
        const propContent = content.substring(startPos + 1, endPos - 1).trim()
        // If it starts with 'type:', it's an output field definition - process it
        if (propContent.match(/^\s*type\s*:/)) {
          const parsedProp = parseConstFieldContent(
            propContent,
            toolPrefix,
            typesContent,
            depth,
            propName
          )
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
      const startPos = match.index + match[0].length - 1
      const endPos = findMatchingClose(content, startPos)

      if (endPos !== -1) {
        const propContent = content.substring(startPos + 1, endPos - 1).trim()
        const parsedProp = parseConstFieldContent(
          propContent,
          toolPrefix,
          typesContent,
          depth,
          propName
        )
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

  const cacheKey = `${toolPrefix}:${constName}`
  if (constResolutionCache.has(cacheKey)) {
    return constResolutionCache.get(cacheKey)!
  }

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
    const result = parseConstFieldContent(constContent, toolPrefix, typesContent, depth)
    if (result) {
      constResolutionCache.set(cacheKey, result)
    }
    return result
  }

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
  depth: number,
  propertyName?: string
): any {
  const typeMatch = fieldContent.match(/type\s*:\s*['"]([^'"]+)['"]/)
  const description = extractDescription(fieldContent)

  if (!typeMatch) return null

  const fieldType = typeMatch[1]

  const result: any = {
    type: fieldType,
    description: description || '',
  }

  if (fieldType === 'object' || fieldType === 'json') {
    const propsConstMatch = matchSchemaKeyword(fieldContent, propertyName, PROPERTIES_CONST_PATTERN)
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
      const propertiesStart = findSchemaKeyword(
        fieldContent,
        propertyName,
        PROPERTIES_INLINE_PATTERN
      )
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

  const itemsConstMatch = matchSchemaKeyword(fieldContent, propertyName, ITEMS_CONST_PATTERN)
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
    const itemsStart = findSchemaKeyword(fieldContent, propertyName, ITEMS_INLINE_PATTERN)
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

/**
 * Resolves the module a tool delegates its config to, for tools built by a
 * factory instead of an inline object literal:
 *
 *   export const embeddingsOpenAITool = createEmbeddingTool({ id, provider, ... })
 *
 * The `params` block lives in the factory's module, so a file-local search finds
 * nothing and the docs page renders an empty Input table. This follows the
 * factory's import the way {@link extractSpreadBase} follows a same-file spread.
 * Returns null when the tool declares its own config, which is the common case.
 */
function resolveFactorySource(fileContent: string, toolFilePath: string, rootDir: string): string {
  const factoryCall = fileContent.match(/=\s*(create\w+)\s*\(\s*\{/)
  if (!factoryCall) return ''

  const factoryName = factoryCall[1]
  const importMatch = fileContent.match(
    new RegExp(`import\\s*\\{[^}]*\\b${factoryName}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`)
  )
  if (!importMatch) return ''

  const specifier = importMatch[1]
  const resolved = specifier.startsWith('@/')
    ? path.join(rootDir, 'apps/sim', specifier.slice(2))
    : path.resolve(path.dirname(toolFilePath), specifier)

  for (const candidate of [`${resolved}.ts`, path.join(resolved, 'index.ts')]) {
    if (fs.existsSync(candidate)) return readSourceFile(candidate)
  }
  return ''
}

/**
 * Reads the module a symbol is imported from, so a spread of a shared const
 * declared in a sibling module can be followed. Returns an empty string when
 * the symbol is not imported or the module cannot be located on disk.
 */
function readImportedModuleSource(
  fileContent: string,
  symbol: string,
  toolFilePath: string,
  rootDir: string
): string {
  const importMatch = fileContent.match(
    new RegExp(`import\\s*(?:type\\s*)?\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`)
  )
  if (!importMatch) return ''

  const specifier = importMatch[1]
  const resolved = specifier.startsWith('@/')
    ? path.join(rootDir, 'apps/sim', specifier.slice(2))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(toolFilePath), specifier)
      : ''
  if (!resolved) return ''

  for (const candidate of [`${resolved}.ts`, path.join(resolved, 'index.ts')]) {
    if (fs.existsSync(candidate)) return readSourceFile(candidate)
  }
  return ''
}

/**
 * Inlines `...sharedConst` spreads inside a `params:` or `outputs:` object body.
 *
 * Tools increasingly hoist their repeated auth/paging/output declarations into a
 * sibling `params.ts`. This generator reads tool *source* rather than importing
 * it, so an unresolved spread silently drops every one of those rows from the
 * published table. Follows same-file declarations first, then the module the
 * symbol is imported from, and recurses so a shared const may itself spread.
 */
function expandSpreadConsts(
  objectBody: string,
  fileContent: string,
  toolFilePath: string,
  rootDir: string,
  seen: Set<string> = new Set()
): string {
  return objectBody.replace(/\.\.\.(\w+)\s*,?/g, (whole, symbol: string) => {
    if (seen.has(symbol)) return ''
    const declRegex = new RegExp(`(?:export\\s+)?const\\s+${symbol}(?=[^a-zA-Z0-9_])[^=]*=\\s*\\{`)

    for (const source of [
      fileContent,
      readImportedModuleSource(fileContent, symbol, toolFilePath, rootDir),
    ]) {
      if (!source) continue
      const declMatch = source.match(declRegex)
      if (!declMatch || declMatch.index === undefined) continue
      const open = declMatch.index + declMatch[0].length - 1
      const close = findMatchingClose(source, open)
      if (close === -1) continue
      const body = source.substring(open + 1, close - 1)
      return `${expandSpreadConsts(body, source, toolFilePath, rootDir, new Set([...seen, symbol]))},`
    }
    return whole
  })
}

function extractObjectPropertyBody(content: string, propertyName: string): string | null {
  const propertyMatch = content.match(new RegExp(`\\b${propertyName}\\s*:\\s*{`))
  if (!propertyMatch || propertyMatch.index === undefined) return null

  const open = propertyMatch.index + propertyMatch[0].length - 1
  const close = findMatchingClose(content, open)
  return close === -1 ? null : content.substring(open + 1, close - 1)
}

export function extractToolInfo(
  toolName: string,
  fileContent: string,
  factorySource = '',
  toolFilePath = '',
  rootDir = '',
  userSettableParamIdSet: ReadonlySet<string> | null = null
): {
  description: string
  params: Array<{ name: string; type: string; required: boolean; description: string }>
  outputs: Record<string, ToolOutputProperty>
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

    // Prefer the params block scoped to this specific tool so that files
    // defining multiple tools (e.g. file_compress + file_decompress in
    // compress.ts) don't all inherit the first tool's params. Fall back to the
    // full file for tools that inherit params via spread from a base object.
    const paramsBody =
      extractObjectPropertyBody(toolContent, 'params') ??
      extractObjectPropertyBody(fileContent, 'params') ??
      extractObjectPropertyBody(factorySource, 'params')

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

    // Match against the actual opening quote so apostrophes inside a double-quoted
    // description (e.g. "Find someone's email") are not treated as the closing quote.
    const descriptionRegex = /description\s*:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/
    let descriptionMatch = descriptionSearchContent.match(descriptionRegex)

    // If description isn't found as a literal (might be inherited like description: baseTool.description),
    // try to find the referenced tool's description
    if (!descriptionMatch) {
      const inheritedDescMatch = descriptionSearchContent.match(
        /description\s*:\s*(\w+)Tool\.description/
      )
      if (inheritedDescMatch) {
        const baseTool = inheritedDescMatch[1]
        const baseToolDescRegex = new RegExp(
          `export\\s+const\\s+${baseTool}Tool[^{]*\\{[\\s\\S]*?description\\s*:\\s*(?:'([^']+)'|"([^"]+)"|\`([^\`]+)\`)`,
          'i'
        )
        const baseToolMatch = fileContent.match(baseToolDescRegex)
        if (baseToolMatch) {
          descriptionMatch = baseToolMatch
        }
      }
    }

    const description = descriptionMatch
      ? (descriptionMatch[1] ??
        descriptionMatch[2] ??
        descriptionMatch[3] ??
        'No description available')
      : 'No description available'

    const params: Array<{ name: string; type: string; required: boolean; description: string }> = []

    if (paramsBody !== null) {
      const paramsContent = expandSpreadConsts(paramsBody, fileContent, toolFilePath, rootDir)

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
          // Resume scanning after this param's block so nested descriptors
          // (e.g. an array param's `items: {...}`) are not parsed as params.
          paramBlocksRegex.lastIndex = endPos
        }
      }

      for (const param of paramPositions) {
        const paramName = param.name
        const paramBlock = param.content

        if (paramName === 'accessToken' || paramName === 'params' || paramName === 'tools') {
          continue
        }

        /**
         * `visibility: 'hidden'` means the param is not an LLM-settable tool argument, so
         * it must not appear in the public Input table — emitting it tells integrators they
         * can override a value they cannot reach, and several such params are credential-
         * shaped (idToken, instanceUrl, apiToken). The exception is a param the owning block
         * still exposes as a field the user types: Mailchimp's `apiKey` is hidden on every
         * tool because the block injects it, yet the block's own `apiKey` subBlock is the
         * only place the requirement is documented. Keep those; drop the rest.
         */
        if (
          userSettableParamIdSet !== null &&
          /visibility\s*:\s*['"]hidden['"]/.test(paramBlock) &&
          !userSettableParamIdSet.has(paramName)
        ) {
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

    const escapedDescription = escapeMdxCell(description)

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
    const constRefRegex = /(\w+)\s*:\s*([A-Z][A-Z_0-9]+)\s*(?:,|$)/g
    let constMatch
    while ((constMatch = constRefRegex.exec(outputsContent)) !== null) {
      const propName = constMatch[1]
      const constName = constMatch[2]

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

      if (outputs[propName]) {
        continue
      }

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

      const beforeMatch = outputsContent.substring(0, spreadMatch.index)
      const openBraces = (beforeMatch.match(/\{/g) || []).length
      const closeBraces = (beforeMatch.match(/\}/g) || []).length
      if (openBraces !== closeBraces) {
        continue
      }

      const resolvedConst = resolveConstReference(constName, toolPrefix)
      if (resolvedConst && typeof resolvedConst === 'object') {
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

function findTopLevelMatch(content: string, pattern: RegExp): RegExpExecArray | null {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const regex = new RegExp(pattern.source, flags)
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    if (isAtDepthZero(content, match.index)) {
      return match
    }
  }

  return null
}

const PROPERTIES_CONST_PATTERN = /properties\s*:\s*([A-Z][A-Z_0-9]+)/
const PROPERTIES_INLINE_PATTERN = /properties\s*:\s*{/
const ITEMS_CONST_PATTERN = /items\s*:\s*([A-Z][A-Z_0-9]+)/
const ITEMS_INLINE_PATTERN = /items\s*:\s*{/

function matchSchemaKeyword(
  content: string,
  propertyName: string | undefined,
  pattern: RegExp
): RegExpExecArray | null {
  return propertyName === 'items' ? findTopLevelMatch(content, pattern) : content.match(pattern)
}

function findSchemaKeyword(
  content: string,
  propertyName: string | undefined,
  pattern: RegExp
): number {
  return propertyName === 'items'
    ? (findTopLevelMatch(content, pattern)?.index ?? -1)
    : content.search(pattern)
}

function parseFieldContent(fieldContent: string, toolPrefix?: string, propertyName?: string): any {
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
    const propsConstMatch = matchSchemaKeyword(fieldContent, propertyName, PROPERTIES_CONST_PATTERN)
    if (propsConstMatch && toolPrefix) {
      const resolvedProps = resolveConstReference(propsConstMatch[1], toolPrefix)
      if (resolvedProps) {
        result.properties = resolvedProps
      }
    } else {
      const propertiesStart = findSchemaKeyword(
        fieldContent,
        propertyName,
        PROPERTIES_INLINE_PATTERN
      )

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
  const itemsConstMatch = matchSchemaKeyword(fieldContent, propertyName, ITEMS_CONST_PATTERN)
  if (itemsConstMatch && toolPrefix) {
    const resolvedItems = resolveConstReference(itemsConstMatch[1], toolPrefix)
    if (resolvedItems) {
      result.items = resolvedItems
    }
  } else {
    const itemsStart = findSchemaKeyword(fieldContent, propertyName, ITEMS_INLINE_PATTERN)

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

export function parsePropertiesContent(
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

      if (propName === 'properties' || propName === 'type') {
        continue
      }

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

      if (propName === 'properties' || propName === 'type') {
        continue
      }

      if (properties[propName]) {
        continue
      }

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

      const beforeMatch = propertiesContent.substring(0, spreadMatch.index)
      const openBraces = (beforeMatch.match(/\{/g) || []).length
      const closeBraces = (beforeMatch.match(/\}/g) || []).length
      if (openBraces !== closeBraces) {
        continue
      }

      const resolvedConst = resolveConstReference(constName, toolPrefix)
      if (resolvedConst && typeof resolvedConst === 'object') {
        Object.assign(properties, resolvedConst)
      }
    }
  }

  const propStartRegex = /(\w+)\s*:\s*{/g
  let match
  const propPositions: Array<{ name: string; start: number; content: string }> = []

  while ((match = propStartRegex.exec(propertiesContent)) !== null) {
    const propName = match[1]

    if (propName === 'properties') {
      continue
    }

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
    const parsedProp = parseFieldContent(prop.content, toolPrefix, prop.name)
    if (parsedProp) {
      properties[prop.name] = parsedProp
    }
  })

  return properties
}

export async function getToolInfo(
  toolName: string,
  userSettableParamIds: readonly string[] | null = null
): Promise<{
  description: string
  params: Array<{ name: string; type: string; required: boolean; description: string }>
  outputs: Record<string, any>
} | null> {
  const userSettableParamIdSet =
    userSettableParamIds === null ? null : new Set(userSettableParamIds)

  try {
    const metadata = (await loadToolMetadata())[toolName]
    const generatedOutputs = (await loadToolOutputs())[toolName]
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

    const isVersionedTool = isVersionedType(toolSuffix)
    const strippedToolSuffix = stripVersionSuffix(toolSuffix)

    const possibleLocations: Array<{ path: string; priority: 'exact' | 'fallback' }> = []

    // For versioned tools, prioritize the exact versioned file first
    // This handles cases like google_sheets where V2 is in a separate file (read_v2.ts)
    if (isVersionedTool) {
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
      possibleLocations.push({
        path: path.join(rootDir, `apps/sim/tools/${toolPrefix}/${toolSuffix}.ts`),
        priority: 'exact',
      })
    }

    const camelCaseSuffix = strippedToolSuffix
      .split('_')
      .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
      .join('')
    possibleLocations.push({
      path: path.join(rootDir, `apps/sim/tools/${toolPrefix}/${camelCaseSuffix}.ts`),
      priority: 'fallback',
    })

    possibleLocations.push({
      path: path.join(rootDir, `apps/sim/tools/${toolPrefix}/index.ts`),
      priority: 'fallback',
    })

    let toolFileContent = ''
    let foundFile = ''
    let foundExactId = false

    for (const location of possibleLocations) {
      if (fs.existsSync(location.path)) {
        const content = readSourceFile(location.path)

        const toolIdRegex = new RegExp(`id:\\s*['"]${toolName}['"]`)
        if (toolIdRegex.test(content)) {
          toolFileContent = content
          foundFile = location.path
          foundExactId = true
          break
        }

        // For fallback locations, store the content in case we don't find an exact match
        if (location.priority === 'fallback' && !toolFileContent) {
          toolFileContent = content
          foundFile = location.path
        }
      }
    }

    // The named-file candidates above miss tools defined inside a sibling tool's
    // file (e.g. file_decompress lives in compress.ts). Before accepting an
    // arbitrary fallback file, scan the whole tool-prefix directory for the file
    // that declares this exact tool ID.
    if (!foundExactId) {
      const prefixDir = path.join(rootDir, `apps/sim/tools/${toolPrefix}`)
      if (fs.existsSync(prefixDir)) {
        const dirFiles = await sourceGlob(`${prefixDir}/**/*.ts`)
        const toolIdRegex = new RegExp(`id:\\s*['"]${toolName}['"]`)
        for (const dirFile of dirFiles) {
          if (dirFile.endsWith('.test.ts')) continue
          const content = readSourceFile(dirFile)
          if (toolIdRegex.test(content)) {
            toolFileContent = content
            foundFile = dirFile
            foundExactId = true
            break
          }
        }
      }
    }

    // If we didn't find a file with the exact ID, use the first available file
    if (!toolFileContent) {
      for (const location of possibleLocations) {
        if (fs.existsSync(location.path)) {
          toolFileContent = readSourceFile(location.path)
          foundFile = location.path
          break
        }
      }
    }

    if (!toolFileContent && !metadata) {
      console.warn(`Could not find definition for tool: ${toolName}`)
      return null
    }

    const sourceInfo = toolFileContent
      ? extractToolInfo(
          toolName,
          toolFileContent,
          resolveFactorySource(toolFileContent, foundFile, rootDir),
          foundFile,
          rootDir,
          userSettableParamIdSet
        )
      : null

    if (!metadata) return sourceInfo

    /**
     * The same hidden-param rule `extractToolInfo` applies to source-parsed params, applied to the
     * metadata-derived ones. `tool-metadata.ts` carries `visibility` for every param, so this is the
     * authoritative form of the check; the source-side filter remains for tools with no metadata
     * entry. A null set means the block's subBlocks could not be read, so nothing is filtered.
     */
    const params = Object.entries(metadata.params ?? {})
      .filter(([name]) => name !== 'accessToken')
      .filter(
        ([name, param]) =>
          userSettableParamIdSet === null ||
          param.visibility !== 'hidden' ||
          userSettableParamIdSet.has(name)
      )
      .map(([name, param]) => ({
        name,
        type: typeof param.type === 'string' ? param.type : 'string',
        required: param.required === true,
        description: typeof param.description === 'string' ? param.description : 'No description',
      }))

    return {
      description: metadata.description ?? sourceInfo?.description ?? 'No description available',
      params,
      outputs:
        toolPrefix === 'sailpoint' || toolName === 'file_edit'
          ? (generatedOutputs ?? sourceInfo?.outputs ?? {})
          : (sourceInfo?.outputs ?? generatedOutputs ?? {}),
    }
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
    const wrapped = `{/* MANUAL-CONTENT-START:${sectionName} */}\n${content}\n{/* MANUAL-CONTENT-END */}`

    const match = insertionPoint ? mergedContent.match(insertionPoint.regex) : null
    if (match && match.index !== undefined) {
      const insertPosition = match.index + match[0].length
      mergedContent = `${mergedContent.slice(0, insertPosition)}\n\n${wrapped}\n${mergedContent.slice(insertPosition)}`
    } else {
      // Never drop manual content: when the anchor is missing (e.g. a `notes`
      // section with no generated "## Notes" heading), append at the end.
      console.log(`No insertion anchor for manual section "${sectionName}" — appending at end`)
      mergedContent = `${mergedContent.replace(/\s*$/, '')}\n\n${wrapped}\n`
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

    const fileContent = readSourceFile(blockPath)

    // Extract ALL block configs from the file (already filters out hideFromToolbar: true)
    const blockConfigs = blockConfigsForFile(blockPath)

    if (blockConfigs.length === 0) {
      console.warn(`Skipping ${blockFileName} - no valid block configs found`)
      return
    }

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
          !NATIVE_RESOURCE_BLOCK_TYPES.has(stripVersionSuffix(blockConfig.type))) ||
        blockConfig.type === 'sim_workspace_event' ||
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

      const existingContent = readGeneratedFile(outputFilePath)

      const manualSections = existingContent ? extractManualContent(existingContent) : {}

      const markdown = await generateMarkdownForBlock(blockConfig, displayType)

      let finalContent = markdown
      if (Object.keys(manualSections).length > 0) {
        finalContent = mergeWithManualContent(markdown, existingContent, manualSections)
      }

      emitGeneratedFile(outputFilePath, finalContent)
      if (!CHECK_ONLY) {
        const logType =
          displayType !== blockConfig.type
            ? `${displayType} (from ${blockConfig.type})`
            : displayType
        console.log(`✓ Generated docs for ${logType}`)
      }
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
    bgColor,
    outputs = {},
    tools = { access: [] },
    userSettableParamIds = null,
  } = blockConfig

  let outputsSection = ''

  if (outputs && Object.keys(outputs).length > 0) {
    outputsSection = '## Outputs\n\n'

    outputsSection += '| Output | Type | Description |\n'
    outputsSection += '| ------ | ---- | ----------- |\n'

    for (const outputKey in outputs) {
      const output = outputs[outputKey]

      const escapedDescription = output.description
        ? escapeMdxCell(output.description)
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
            ? escapeMdxCell(prop.description)
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
    toolsSection = '## Actions\n\n'

    const displayNames = await loadToolDisplayNames()

    for (const tool of tools.access) {
      // Prefer the tool's own name ("A2A Send Message") over its id — the id is an
      // implementation detail, and these headings are what the page's table of
      // contents shows. Falls back to the id for a tool missing from the metadata.
      const heading = displayNames.get(tool) ?? displayNames.get(stripVersionSuffix(tool))
      toolsSection += `### ${heading ?? stripVersionSuffix(tool)}\n\n`

      console.log(`Getting info for tool: ${tool}`)
      const toolInfo = await getToolInfo(tool, userSettableParamIds)

      if (toolInfo) {
        if (toolInfo.description && toolInfo.description !== 'No description available') {
          const escapedToolDescription = escapeMdxProse(toolInfo.description)
          toolsSection += `${escapedToolDescription}\n\n`
        }

        toolsSection += '#### Input\n\n'
        toolsSection += '| Parameter | Type | Required | Description |\n'
        toolsSection += '| --------- | ---- | -------- | ----------- |\n'

        if (toolInfo.params.length > 0) {
          for (const param of toolInfo.params) {
            const escapedDescription = param.description
              ? escapeMdxCell(param.description)
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

            const escapedDescription = escapeMdxCell(description)

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
 * Compute the canonical set of stripped block types that should have a
 * `docs/tools/*.mdx` file — namely every visible `category: 'tools'` block
 * (matching the writer filter at the top of this script). Any existing MDX
 * not in this set is stale and gets cleaned up.
 *
 * Uses `extractAllBlockConfigs` so spread-inherited fields (e.g. a V2 that
 * spreads `...GmailBlock` and inherits `category: 'tools'`) are resolved the
 * same way the writer resolves them. `stripVersionSuffix` ensures V1 and V2
 * map to the same doc filename — alphabetical glob order means the newest
 * version naturally wins for both generation and cleanup.
 */
async function getCanonicalToolDocNames(): Promise<Set<string>> {
  const validToolDocs = new Set<string>()
  const blockFiles = (await sourceGlob(`${BLOCKS_PATH}/*.ts`)).sort()

  for (const blockFile of blockFiles) {
    const configs = blockConfigsForFile(blockFile)

    for (const config of configs) {
      // Match the writer filter: integration blocks, the documented
      // native-resource blocks (category 'blocks'), and trigger-only service
      // blocks (category 'triggers') whose pages the trigger pass writes.
      const stripped = config.type ? stripVersionSuffix(config.type) : ''
      const isDocumentedResource = NATIVE_RESOURCE_BLOCK_TYPES.has(stripped)
      const isTriggerService =
        config.category === 'triggers' &&
        !config.hideFromToolbar &&
        stripped !== 'sim_workspace_event'
      if (!isIntegrationBlock(config) && !isDocumentedResource && !isTriggerService) continue
      validToolDocs.add(stripped)
    }
  }

  return validToolDocs
}

/**
 * Remove any `docs/tools/*.mdx` that no longer corresponds to a visible
 * `category: 'tools'` block — covers both hidden blocks and blocks that
 * have been re-categorized to `'blocks'` / `'triggers'`. Keeps the
 * tools/ docs directory in lockstep with the canonical block registry.
 */
function cleanupStaleToolDocs(validToolDocs: Set<string>): void {
  console.log('Cleaning up stale tool docs...')

  const existingDocs = fs
    .readdirSync(DOCS_OUTPUT_PATH)
    .filter((file: string) => file.endsWith('.mdx'))

  let removedCount = 0
  let keptForManualContent = 0

  for (const docFile of existingDocs) {
    const blockType = path.basename(docFile, '.mdx')
    if (HANDWRITTEN_INTEGRATION_DOCS.has(blockType)) continue
    if (validToolDocs.has(blockType)) continue

    const docPath = path.join(DOCS_OUTPUT_PATH, docFile)

    // Deleting a page that a later writer re-emits destroys its hand-written
    // MANUAL-CONTENT blocks: the writer merges against the file on disk, and a
    // deleted file reads as "no manual content". Whenever the two filters
    // disagree, keep the prose and let the mismatch be fixed deliberately.
    // Gate on what `extractManualContent` can actually recover — a stray or
    // unterminated start marker preserves nothing, so it must not pin the page.
    const manualSections = extractManualContent(fs.readFileSync(docPath, 'utf-8'))
    if (Object.values(manualSections).some((section) => section.length > 0)) {
      console.warn(
        `⚠ Keeping ${blockType}.mdx: considered stale but holds MANUAL-CONTENT. ` +
          `Add it to a doc-emitting set or delete it by hand once the content is migrated.`
      )
      keptForManualContent++
      continue
    }

    if (CHECK_ONLY) {
      wouldDeletePaths.push(docPath)
      continue
    }

    fs.unlinkSync(docPath)
    console.log(`✓ Removed stale tool doc: ${blockType}.mdx`)
    removedCount++
  }

  if (keptForManualContent > 0) {
    console.log(`⚠ Kept ${keptForManualContent} stale-looking doc(s) holding manual content`)
  }

  if (removedCount > 0) {
    console.log(`✓ Cleaned up ${removedCount} stale tool doc files`)
  } else {
    console.log('✓ No stale tool docs to clean up')
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
 * Escapes MDX-hostile characters in text emitted as a paragraph rather than a table cell.
 *
 * MDX reads `{` as an expression and `<` as the start of a JSX tag, so a tool description
 * like `The copy is named "<original> - copy"` fails the docs build outright with
 * "Expected a closing tag for `<original>`". Unlike {@link escapeMdxCell} this leaves
 * pipes, parens and brackets alone — those are legal in prose, and escaping them would
 * mangle markdown links.
 */
function escapeMdxProse(text: string): string {
  return text
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const markdownCellParser = unified().use(remarkParse).use(remarkGfm)

/** Escape literal reference text without inserting backslashes into GFM autolinks. */
export function escapeMdxCell(text: string): string {
  const escaped = text
    .replace(/\|/g, '\\|')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  if (!/(?:https?:\/\/|www\.)/i.test(escaped) || !/\\[()[\]]/.test(escaped)) {
    return escaped
  }

  const autolinkRanges: Array<{ start: number; end: number }> = []
  visit(markdownCellParser.parse(escaped), 'link', ({ position }) => {
    const start = position?.start.offset
    const end = position?.end.offset
    if (start !== undefined && end !== undefined) autolinkRanges.push({ start, end })
  })

  return escaped.replace(/\\[()[\]]/g, (escapedCharacter: string, offset: number) =>
    autolinkRanges.some(({ start, end }) => offset >= start && offset < end)
      ? escapedCharacter.slice(1)
      : escapedCharacter
  )
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

/** Keys a `TriggerOutput` reserves for itself; everything else is a nested property. */
const TRIGGER_OUTPUT_RESERVED_KEYS = new Set([
  'type',
  'description',
  'condition',
  'properties',
  'items',
])

/**
 * Convert a trigger's registry `outputs` into the `{ type, description, properties }`
 * shape the docs renderer walks.
 *
 * A `TriggerOutput` expresses a nested object by simply omitting `type` and holding its
 * children as sibling keys (`issue: { id: {...}, title: {...} }`), while the renderer only
 * descends into `properties` on a node typed `object`/`json`. Handing it the raw registry
 * value would print every nested group as a single `unknown` row with its children dropped.
 *
 * Classification is unambiguous: a node with a string `type` is a leaf, anything else is a
 * group. No registry group carries a string `description` of its own, so a nested property
 * genuinely named `description` is preserved rather than mistaken for the group's own text.
 */
function normalizeTriggerOutputs(raw: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'condition') continue
    if (typeof value !== 'object' || value === null) continue
    normalized[key] = normalizeTriggerOutputNode(value)
  }
  return normalized
}

function normalizeTriggerOutputNode(node: Record<string, any>): Record<string, any> {
  const type = typeof node.type === 'string' ? node.type : undefined
  const description = typeof node.description === 'string' ? node.description : ''

  const inlineChildren: Record<string, any> = {}
  for (const [key, value] of Object.entries(node)) {
    const isOwnDescription = key === 'description' && typeof node.description === 'string'
    if (isOwnDescription || (TRIGGER_OUTPUT_RESERVED_KEYS.has(key) && key !== 'description')) {
      continue
    }
    if (typeof value !== 'object' || value === null) continue
    inlineChildren[key] = value
  }

  if (type === undefined) {
    return { type: 'object', description, properties: normalizeTriggerOutputs(inlineChildren) }
  }

  const result: Record<string, any> = { type, description }
  if (node.items && typeof node.items === 'object') {
    const items = node.items as Record<string, any>
    result.items =
      items.properties && typeof items.properties === 'object'
        ? { ...items, properties: normalizeTriggerOutputs(items.properties) }
        : items
  }
  const declaredProperties =
    node.properties && typeof node.properties === 'object' ? node.properties : undefined
  if (declaredProperties || Object.keys(inlineChildren).length > 0) {
    result.properties = normalizeTriggerOutputs({ ...declaredProperties, ...inlineChildren })
  }
  return result
}

/**
 * A trigger's user-facing configuration fields, in declaration order.
 *
 * Read from the evaluated registry rather than parsed out of source. Static parsing silently
 * dropped every field whose builder assembled its array imperatively or took a description as
 * a parameter — that is how all ten Jira triggers lost `webhookSecret` and `jqlFilter` — and
 * a regex that recovered them also invented `fieldFilters` on the nine triggers that never
 * declare it. Wrong config is worse than absent config, so this evaluates the real objects.
 */
function triggerConfigFields(trigger: RegistryTrigger | undefined): TriggerConfigField[] {
  const fields: TriggerConfigField[] = []
  for (const subBlock of trigger?.subBlocks ?? []) {
    if (!subBlock.id || subBlock.hidden === true || TRIGGER_UI_ONLY_IDS.has(subBlock.id)) continue
    if (subBlock.type === 'text' || subBlock.readOnly === true) continue
    fields.push({
      id: subBlock.id,
      title: subBlock.title ?? subBlock.id,
      type: subBlock.type ?? 'short-input',
      // Only an unconditional `true` counts. `required` is also allowed to be a
      // condition object (`{ field, value }`), which makes the field required for
      // some configurations and not others — "No" is the honest summary there.
      required: subBlock.required === true,
      placeholder: typeof subBlock.placeholder === 'string' ? subBlock.placeholder : undefined,
      // Falling back to the title keeps oauth-input and other description-less
      // fields from rendering an empty cell.
      description: subBlock.description ?? subBlock.title,
    })
  }
  return fields
}

/**
 * Build the full trigger registry: id → TriggerFullInfo.
 * Parses every trigger source file for config fields and output schemas.
 */
async function buildFullTriggerRegistry(): Promise<Map<string, TriggerFullInfo>> {
  const registry = new Map<string, TriggerFullInfo>()
  const SKIP = new Set(['index.ts', 'registry.ts', 'types.ts', 'constants.ts', 'utils.ts'])

  const triggerFiles = (await sourceGlob(`${TRIGGERS_PATH}/**/*.ts`)).filter(
    (f) => !SKIP.has(path.basename(f)) && !f.includes('.test.')
  )
  const registryTriggers = await loadTriggerRegistry()

  for (const file of triggerFiles) {
    try {
      const content = readSourceFile(file)

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

        // Deprecated triggers stay registered for existing workflows but are
        // excluded from generated documentation.
        if (/\bdeprecated\s*:\s*true/.test(segment)) continue

        const polling = /\bpolling\s*:\s*true/.test(segment)
        const registryTrigger = registryTriggers[idMatch[1]]

        registry.set(idMatch[1], {
          id: idMatch[1],
          name: nameMatch[1],
          description: descMatch?.[1] ?? '',
          provider: providerMatch[1],
          polling,
          outputs: normalizeTriggerOutputs(registryTrigger?.outputs ?? {}),
          configFields: triggerConfigFields(registryTrigger),
        })
      }

      const factoryExportRegex =
        /export\s+const\s+\w+(?:\s*:\s*TriggerConfig)?\s*=\s*\w+\s*\(\s*['"]([^'"]+)['"]/g
      let factoryExportMatch: RegExpExecArray | null
      while ((factoryExportMatch = factoryExportRegex.exec(content)) !== null) {
        const trigger = registryTriggers[factoryExportMatch[1]]
        if (
          !trigger?.id ||
          !trigger.name ||
          !trigger.provider ||
          trigger.deprecated ||
          registry.has(trigger.id)
        ) {
          continue
        }

        registry.set(trigger.id, {
          id: trigger.id,
          name: trigger.name,
          description: trigger.description ?? '',
          provider: trigger.provider,
          polling: trigger.polling === true,
          outputs: normalizeTriggerOutputs(trigger.outputs ?? {}),
          configFields: triggerConfigFields(trigger),
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
      [...byName.values()].sort((a, b) => compareCatalogNames(a.name, b.name))
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
/**
 * Build the "## Triggers" section for an integration page. A trigger is a block
 * that starts a workflow, so this is appended to the service's actions page (or
 * used as the body of a trigger-only service page).
 */
function buildTriggersSection(triggers: TriggerFullInfo[]): string {
  const allPolling = triggers.every((t) => t.polling)
  const mixedTypes = triggers.some((t) => t.polling) && triggers.some((t) => !t.polling)

  let typeNote = ''
  if (allPolling) {
    typeNote =
      '\nThese run on a schedule \\(**polling-based**\\) — they check for new data rather than receiving push notifications.\n'
  } else if (mixedTypes) {
    typeNote =
      '\nSome of these are **polling-based** \\(checked on a schedule\\) while others are push-based webhooks.\n'
  }

  let triggersSection = ''
  for (let i = 0; i < triggers.length; i++) {
    const trigger = triggers[i]

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
    const escapedTriggerDescription = escapeMdxProse(trigger.description)
    triggersSection += `${escapedTriggerDescription}\n\n`
    triggersSection += configSection
    triggersSection += outputSection
    triggersSection += separator
  }

  return `## Triggers

A **Trigger** is a block that starts a workflow when an event happens in this service.
${typeNote}
${triggersSection}`
}

/** Standalone page for a trigger-only service (no actions block). */
function generateTriggerProviderDoc(
  provider: string,
  triggers: TriggerFullInfo[],
  blockType: string,
  providerColor: string
): string {
  const providerName = formatTriggerProviderName(provider)
  return `---
title: ${providerName}
description: ${providerName} triggers for automating workflows
---

import { BlockInfoCard } from "@/components/ui/block-info-card"

<BlockInfoCard
  type="${blockType}"
  color="${providerColor}"
/>

${buildTriggersSection(triggers)}`
}

/**
 * Build a map of block-type → bgColor from all block definitions.
 * Used to pick provider colours for the BlockInfoCard on trigger pages.
 */
async function buildProviderColorMap(): Promise<Map<string, string>> {
  const colorMap = new Map<string, string>()
  const blockFiles = (await sourceGlob(`${BLOCKS_PATH}/*.ts`)).sort()

  for (const blockFile of blockFiles) {
    const configs = blockConfigsForFile(blockFile)
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
/**
 * Trigger ids that every hosting block gates behind `preview: true`.
 *
 * Blocks declare the triggers they expose via `triggers.available`. A trigger
 * listed only by preview blocks inherits their gate, while triggers no block
 * claims are left alone because standalone webhook providers are legitimately
 * unlisted and must keep their pages.
 */
async function collectPreviewOnlyTriggerIds(): Promise<Set<string>> {
  const listedByReleased = new Set<string>()
  const listedByPreview = new Set<string>()

  const blockFiles = (await sourceGlob(`${BLOCKS_PATH}/*.ts`)).sort()
  for (const blockFile of blockFiles) {
    const fileContent = readSourceFile(blockFile)
    const exportRegex = /export\s+const\s+(\w+)Block\s*:\s*BlockConfig[^=]*=\s*\{/g
    let match: RegExpExecArray | null

    while ((match = exportRegex.exec(fileContent)) !== null) {
      const startIndex = match.index + match[0].length - 1
      const endIndex = findMatchingClose(fileContent, startIndex)
      if (endIndex === -1) continue

      const blockContent = fileContent.substring(startIndex, endIndex)
      const available = extractArrayPropertyFromContent(blockContent, 'available')
      if (!available?.length) continue

      const target = isPreviewSource(blockContent) ? listedByPreview : listedByReleased
      for (const triggerId of available) target.add(triggerId)
    }
  }

  return new Set([...listedByPreview].filter((id) => !listedByReleased.has(id)))
}

async function generateAllTriggerDocs(): Promise<void> {
  try {
    console.log('Generating trigger documentation...')

    if (!fs.existsSync(TRIGGER_DOCS_OUTPUT_PATH)) {
      fs.mkdirSync(TRIGGER_DOCS_OUTPUT_PATH, { recursive: true })
    }

    const fullRegistry = await buildFullTriggerRegistry()

    // A trigger reachable only through a preview-gated block is as unreleased
    // as that block — documenting it publishes an unshipped surface (and, when
    // its provider has no released block, mints a whole page for it).
    const previewOnly = await collectPreviewOnlyTriggerIds()
    for (const triggerId of previewOnly) {
      if (fullRegistry.delete(triggerId)) {
        console.log(`Skipping trigger ${triggerId} — only hosted by a preview-gated block`)
      }
    }

    const grouped = groupTriggersByProvider(fullRegistry)
    const colorMap = await buildProviderColorMap()

    const generatedProviders: string[] = []

    for (const [provider, triggers] of grouped) {
      if (SKIP_TRIGGER_PROVIDERS.has(provider)) {
        console.log(`Skipping trigger provider: ${provider}`)
        continue
      }

      // The trigger lives on the same per-service integration page as the
      // service's actions (provider ≠ block type for a few services).
      const blockType = PROVIDER_TO_BLOCK_TYPE[provider] ?? provider
      const outputFilePath = path.join(DOCS_OUTPUT_PATH, `${blockType}.mdx`)
      const baseName = path.basename(outputFilePath, '.mdx')

      if (HANDWRITTEN_INTEGRATION_DOCS.has(baseName) || HANDWRITTEN_TRIGGER_DOCS.has(baseName)) {
        console.log(`Skipping ${provider} — hand-written page`)
        continue
      }

      const existing = readGeneratedFile(outputFilePath)

      if (existing?.includes('\n## Actions')) {
        // Actions page generated this run by the block pass — append the Triggers section.
        if (!existing.includes('\n## Triggers')) {
          if (CHECK_ONLY) {
            emittedByPath.set(outputFilePath, `${existing}\n${buildTriggersSection(triggers)}`)
          } else {
            fs.appendFileSync(outputFilePath, `\n${buildTriggersSection(triggers)}`)
          }
        }
      } else {
        // Trigger-only service (no actions block) — (re)write the standalone page,
        // preserving manual content from the previous run. Cleanup spares these
        // pages (category 'triggers' blocks are in the canonical set).
        const providerColor = colorMap.get(blockType) ?? '#6B7280'
        const markdown = generateTriggerProviderDoc(provider, triggers, blockType, providerColor)
        const rawSections = existing ? extractManualContent(existing) : {}
        const manualSections = Object.fromEntries(
          Object.entries(rawSections).filter(([, v]) => v.length > 0)
        )
        const finalContent =
          Object.keys(manualSections).length > 0
            ? mergeWithManualContent(markdown, existing, manualSections)
            : markdown
        emitGeneratedFile(outputFilePath, finalContent)
      }

      generatedProviders.push(blockType)
      if (!CHECK_ONLY) {
        console.log(
          `✓ Triggers for ${formatTriggerProviderName(provider)} (${triggers.length} trigger${triggers.length === 1 ? '' : 's'})`
        )
      }
    }

    console.log(`✓ Trigger sections merged into ${generatedProviders.length} integration pages`)
  } catch (error) {
    console.error('Error generating trigger documentation:', error)
  }
}

async function generateAllBlockDocs() {
  try {
    const blockFiles = (await sourceGlob(`${BLOCKS_PATH}/*.ts`)).sort()

    copyIconsFile()

    const {
      docs: docsIconMapping,
      visible: visibleIconMapping,
      coreBlockTypes,
    } = await generateIconMappings()
    writeIconMapping(docsIconMapping, coreBlockTypes)

    await writeIntegrationsJson(visibleIconMapping)
    writeIntegrationsIconMapping(visibleIconMapping)

    // Compute the canonical set of tool docs and clean up anything stale —
    // covers hidden blocks AND blocks re-categorized away from `'tools'`.
    const validToolDocs = await getCanonicalToolDocNames()
    cleanupStaleToolDocs(validToolDocs)

    for (const blockFile of blockFiles) {
      await generateBlockDoc(blockFile)
    }

    // Merge trigger sections into the per-service pages (and write trigger-only pages)
    await generateAllTriggerDocs()

    // Write the integrations meta after both passes so trigger-only pages are included
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

  /** Fumadocs uses an unlisted index as the folder link; listing it creates a duplicate child. */
  const items = blockFiles
    .filter((file: string) => file !== 'index' && !(file in integrationNavigation.redirects))
    .sort()

  const metaJson = {
    pages: items,
  }

  emitGeneratedFile(metaJsonPath, `${JSON.stringify(metaJson, null, 2)}\n`)
  if (!CHECK_ONLY) console.log(`Updated meta.json with ${items.length} entries`)
}

if (import.meta.main) {
  CHECK_ONLY = process.argv.includes('--check')
  console.log(
    CHECK_ONLY
      ? 'Checking generated documentation freshness...'
      : 'Starting documentation generator...'
  )
  generateAllBlockDocs()
    .then((success) => {
      if (!success) {
        console.error('Documentation generation failed')
        process.exit(1)
      }
      if (CHECK_ONLY) {
        const genuinelyDeleted = wouldDeletePaths
          .filter((docPath) => !emittedByPath.has(docPath))
          .map(
            (docPath) =>
              `${path.relative(rootDir, docPath)} (stale page — regeneration would delete it)`
          )
        const stale = [...collectStaleEmissions(), ...staleArtifacts, ...genuinelyDeleted]
        if (stale.length > 0) {
          console.error(
            `Generated integration docs are stale:\n- ${stale.join('\n- ')}\n` +
              'Run `bun run scripts/generate-docs.ts` and commit the result.'
          )
          process.exit(1)
        }
        console.log('✓ Generated integration docs are in sync')
        process.exit(0)
      }
      console.log('Documentation generation completed successfully')
      process.exit(0)
    })
    .catch((error) => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}
