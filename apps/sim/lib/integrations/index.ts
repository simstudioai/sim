/**
 * Canonical entry point for everything integrations-related. Landing
 * `/integrations`, workspace integrations, and the sitemap all import from
 * here so the data shape and helpers stay in lockstep.
 *
 * `INTEGRATIONS` is the serialized projection of `BlockConfig` written by
 * `scripts/generate-docs.ts` whenever a block changes.
 *
 * Deliberately free of `@/blocks` value imports: the landing `/integrations`
 * grid is a client component, so anything imported here that reaches
 * `blocks/registry-maps` ships all 282 block configs and the tool registry to a
 * public marketing page. `POPULAR_WORKFLOWS` lives in
 * `@/lib/integrations/popular-workflows` for exactly that reason. Type-only
 * imports are fine — they erase.
 */

import integrationsJson from '@sim/deployment-config/integrations.json'
import type { Integration, IntegrationSummary } from '@/lib/integrations/types'

/** All integrations surfaced in the catalog, ordered by `scripts/generate-docs.ts`. */
export const INTEGRATIONS: readonly Integration[] =
  integrationsJson.integrations as readonly Integration[]

/**
 * ISO date of the last real catalog change, stamped by `scripts/generate-docs.ts`.
 * Drives sitemap `lastModified`, JSON-LD `dateModified`, and the visible
 * last-updated line on integration pages.
 */
export const INTEGRATIONS_UPDATED_AT: string = integrationsJson.updatedAt

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

export {
  type CredentialDisplay,
  resolveCredentialDisplay,
} from '@/lib/integrations/credential-display'
export { blockTypeToIconMap } from '@/lib/integrations/icon-mapping'
export {
  type OAuthServiceMatch,
  resolveOAuthServiceForIntegration,
  resolveOAuthServiceForSlug,
} from '@/lib/integrations/oauth-service'
export type { AuthType, FAQItem, Integration, IntegrationSummary } from '@/lib/integrations/types'
export type { BlockMeta, BlockTemplate } from '@/blocks/types'
export { formatIntegrationType } from '@/blocks/types'
