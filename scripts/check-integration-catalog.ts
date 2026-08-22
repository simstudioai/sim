#!/usr/bin/env bun
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { stripVersionSuffix } from '@sim/utils/string'
/**
 * Verifies the registry-free integration catalog matches the executable block
 * registry fields that deployment availability depends on.
 */
import { BLOCK_REGISTRY } from '../apps/sim/blocks/registry-maps'
import { AuthMode, type BlockConfig } from '../apps/sim/blocks/types'
import integrationsJson from '../packages/deployment-config/src/integrations.json'
import { DOCS_ORIGIN, DOCS_OUTPUT_PATH, defaultIntegrationDocsUrl } from './generate-docs'

type CatalogAuthType = 'oauth' | 'api-key' | 'none'

interface CatalogEntry {
  type: string
  slug: string
  name: string
  category: string
  integrationType: string
  authType: CatalogAuthType
  oauthServiceId?: string
}

function resolveAuthType(block: BlockConfig): CatalogAuthType {
  if (block.authMode === AuthMode.OAuth) return 'oauth'
  if (block.authMode === AuthMode.ApiKey || block.authMode === AuthMode.BotToken) return 'api-key'
  if (block.subBlocks.some((subBlock) => subBlock.type === 'oauth-input')) return 'oauth'
  if (
    block.subBlocks.some((subBlock) => ['apiKey', 'api_key', 'accessToken'].includes(subBlock.id))
  ) {
    return 'api-key'
  }
  return 'none'
}

function resolveOAuthServiceId(block: BlockConfig): string | undefined {
  const serviceIds = new Set(
    block.subBlocks
      .filter((subBlock) => subBlock.type === 'oauth-input')
      .map((subBlock) => subBlock.serviceId)
      .filter((serviceId): serviceId is string => Boolean(serviceId))
  )
  if (serviceIds.size > 1) {
    throw new Error(
      `Integration block "${block.type}" declares more than one OAuth service ID: ${[...serviceIds].join(', ')}`
    )
  }
  return serviceIds.values().next().value
}

function expectedEntry(block: BlockConfig): CatalogEntry {
  if (!block.integrationType) {
    throw new Error(`Integration block "${block.type}" is missing integrationType`)
  }
  const authType = resolveAuthType(block)
  const oauthServiceId = authType === 'oauth' ? resolveOAuthServiceId(block) : undefined
  if (authType === 'oauth' && !oauthServiceId) {
    throw new Error(`OAuth integration block "${block.type}" is missing an OAuth service ID`)
  }
  return {
    type: block.type,
    slug: block.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, ''),
    name: block.name,
    category: block.category,
    integrationType: block.integrationType,
    authType,
    ...(oauthServiceId ? { oauthServiceId } : {}),
  }
}

/**
 * A `docsLink` path carries its own section segment (`integrations/…`), so it
 * resolves against the locale root rather than the integrations directory.
 */
const DOCS_LOCALE_ROOT = dirname(DOCS_OUTPUT_PATH)

/**
 * Verifies every visible integration's `docsLink` resolves to a real Sim docs
 * page.
 *
 * A hand-written `docsLink` overrides {@link defaultIntegrationDocsUrl}, so a
 * typo — a hyphen where the page uses an underscore, a stale `tools/` prefix,
 * or a vendor URL pasted in place of ours — silently ships a link that misses
 * Sim's own page, and no other check looks at it. Every visible integration
 * gets a generated page, so pointing anywhere else is always a mistake; link to
 * the vendor from `BlockMeta.url` instead.
 */
function verifyDocsLinks(blocks: readonly BlockConfig[]): void {
  const issues: string[] = []
  for (const block of blocks) {
    const docsLink = block.docsLink ?? defaultIntegrationDocsUrl(block.type)
    if (!docsLink.startsWith(DOCS_ORIGIN)) {
      issues.push(
        `"${block.type}" docsLink points outside ${DOCS_ORIGIN} (${docsLink}) — link to Sim's own page and put the vendor's docs on BlockMeta.url`
      )
      continue
    }
    const page = docsLink.slice(DOCS_ORIGIN.length)
    if (!existsSync(join(DOCS_LOCALE_ROOT, `${page}.mdx`))) {
      issues.push(`"${block.type}" docsLink 404s — no docs page at en/${page}.mdx (${docsLink})`)
    }
  }
  if (issues.length > 0) {
    throw new Error(
      `Integration docs links are broken:\n- ${issues.join('\n- ')}\nPoint docsLink at an existing page, or drop it to use the generated default.`
    )
  }
}

function verifyIntegrationCatalog(): void {
  const expected = Object.values(BLOCK_REGISTRY).filter(
    (block) => block.category === 'tools' && !block.hideFromToolbar && !block.preview
  )
  verifyDocsLinks(expected)
  const expectedBaseTypes = new Map<string, string>()
  for (const block of expected) {
    const baseType = stripVersionSuffix(block.type)
    const existing = expectedBaseTypes.get(baseType)
    if (existing) {
      throw new Error(
        `Visible integration blocks "${existing}" and "${block.type}" share base type "${baseType}"`
      )
    }
    expectedBaseTypes.set(baseType, block.type)
  }

  const actual = integrationsJson.integrations as readonly CatalogEntry[]
  const expectedByType = new Map(expected.map((block) => [block.type, expectedEntry(block)]))
  const actualByType = new Map<string, CatalogEntry>()
  const actualSlugs = new Set<string>()
  for (const entry of actual) {
    if (actualByType.has(entry.type)) {
      throw new Error(`Generated integration catalog contains duplicate type "${entry.type}"`)
    }
    if (actualSlugs.has(entry.slug)) {
      throw new Error(`Generated integration catalog contains duplicate slug "${entry.slug}"`)
    }
    actualByType.set(entry.type, entry)
    actualSlugs.add(entry.slug)
  }

  const issues: string[] = []
  for (const [type, entry] of expectedByType) {
    const generated = actualByType.get(type)
    if (!generated) {
      issues.push(`missing generated entry for "${type}"`)
      continue
    }
    for (const field of [
      'name',
      'slug',
      'category',
      'integrationType',
      'authType',
      'oauthServiceId',
    ] as const) {
      if (generated[field] !== entry[field]) {
        issues.push(`"${type}" has stale ${field}`)
      }
    }
  }
  for (const type of actualByType.keys()) {
    if (!expectedByType.has(type)) issues.push(`unexpected generated entry for "${type}"`)
  }

  if (issues.length > 0) {
    throw new Error(
      `Generated integration catalog is stale:\n- ${issues.join('\n- ')}\nRun \`bun run scripts/generate-docs.ts\` and commit the generated catalog.`
    )
  }
  process.stdout.write(
    `Integration deployment metadata is in sync (${actual.length} integrations).\n`
  )
}

verifyIntegrationCatalog()
