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
import type { Integration, IntegrationSummary } from '@/lib/integrations/types'
import { getAllBlockMeta } from '@/blocks/registry'

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

/**
 * Projects a full `Integration` down to the fields the `/integrations`
 * catalog grid renders and searches by, replacing the full `operations`/
 * `triggers` arrays with a precomputed, lowercased `searchFields` index
 * (name, description, every operation's name and description, every
 * trigger's name) - the exact same fields the original per-field search
 * over `Integration[]` matched against. See {@link IntegrationSummary} for
 * why this exists.
 */
export function toIntegrationSummary(integration: Integration): IntegrationSummary {
  const searchFields = [
    integration.name.toLowerCase(),
    integration.description.toLowerCase(),
    ...integration.operations.flatMap((op) => [
      op.name.toLowerCase(),
      op.description.toLowerCase(),
    ]),
    ...integration.triggers.map((t) => t.name.toLowerCase()),
  ]

  return {
    type: integration.type,
    slug: integration.slug,
    name: integration.name,
    description: integration.description,
    bgColor: integration.bgColor,
    integrationType: integration.integrationType,
    searchFields,
  }
}

export { blockTypeToIconMap } from '@/lib/integrations/icon-mapping'
export {
  type OAuthServiceMatch,
  resolveOAuthServiceForIntegration,
  resolveOAuthServiceForSlug,
} from '@/lib/integrations/oauth-service'
export type { AuthType, FAQItem, Integration, IntegrationSummary } from '@/lib/integrations/types'
export { getAllBlockMeta, getBlockMeta, getTemplatesForBlock } from '@/blocks/registry'
export type { BlockMeta, BlockTemplate } from '@/blocks/types'
export { formatIntegrationType } from '@/blocks/types'
