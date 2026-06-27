/**
 * Canonical entry point for everything integrations-related. Landing
 * `/integrations`, workspace integrations, and the sitemap all import from
 * here so the data shape and helpers stay in lockstep.
 *
 * `INTEGRATIONS` is the serialized projection of `BlockConfig` written by
 * `scripts/generate-docs.ts` whenever a block changes.
 *
 * `POPULAR_WORKFLOWS` is derived from each block's `*BlockMeta` export (see
 * `apps/sim/blocks/registry.ts`, which now hosts both the execution
 * `BlockConfig` lookups and the presentation `BlockMeta` lookups). Block
 * files are the source of truth for both surfaces.
 */

import { stripVersionSuffix } from '@sim/utils/string'
import integrationsJson from '@/lib/integrations/integrations.json'
import type { Integration } from '@/lib/integrations/types'
import { getAllBlockMeta } from '@/blocks/manifest'

/** All integrations surfaced in the catalog, ordered by `scripts/generate-docs.ts`. */
export const INTEGRATIONS: readonly Integration[] =
  integrationsJson.integrations as readonly Integration[]

/**
 * ISO date of the last real catalog change, stamped by `scripts/generate-docs.ts`.
 * Drives sitemap `lastModified`, JSON-LD `dateModified`, and the visible
 * last-updated line on integration pages.
 */
export const INTEGRATIONS_UPDATED_AT: string = integrationsJson.updatedAt

/** A curated `from → to` block-pair workflow surfaced on the landing page. */
export interface PopularWorkflow {
  /** Integration display name (matches `Integration.name`). */
  from: string
  /** Integration display name. */
  to: string
  headline: string
  description: string
}

const TYPE_TO_NAME = new Map<string, string>()
for (const integration of INTEGRATIONS) {
  TYPE_TO_NAME.set(integration.type, integration.name)
  TYPE_TO_NAME.set(stripVersionSuffix(integration.type), integration.name)
}

/**
 * Curated popular workflow pairs (templates flagged `featured: true` that
 * reference at least one other integration). Derived from per-block meta —
 * each entry's `from` is the owner block, `to` is the first
 * `alsoIntegrations` entry, and `headline`/`description` come from the
 * template title and prompt.
 */
export const POPULAR_WORKFLOWS: readonly PopularWorkflow[] = (() => {
  const pairs: PopularWorkflow[] = []
  for (const [ownerType, meta] of Object.entries(getAllBlockMeta())) {
    for (const template of meta.templates ?? []) {
      if (!template.featured) continue
      const toType = template.alsoIntegrations?.[0]
      if (!toType) continue
      const from = TYPE_TO_NAME.get(ownerType) ?? TYPE_TO_NAME.get(stripVersionSuffix(ownerType))
      const to = TYPE_TO_NAME.get(toType) ?? TYPE_TO_NAME.get(stripVersionSuffix(toType))
      if (!from || !to) continue
      pairs.push({ from, to, headline: template.title, description: template.prompt })
    }
  }
  return pairs
})()

export { blockTypeToIconMap } from '@/lib/integrations/icon-mapping'
export {
  type OAuthServiceMatch,
  resolveOAuthServiceForIntegration,
  resolveOAuthServiceForSlug,
} from '@/lib/integrations/oauth-service'
export type { AuthType, FAQItem, Integration } from '@/lib/integrations/types'
export { getAllBlockMeta, getBlockMeta, getTemplatesForBlock } from '@/blocks/manifest'
export type { BlockMeta, BlockTemplate } from '@/blocks/types'
export { formatIntegrationType } from '@/blocks/types'
