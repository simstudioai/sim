import { INTEGRATION_METADATA } from '@sim/deployment-config/integration-metadata'

/**
 * Docs integration pages are keyed by block type without its version suffix (`gmail_v2` →
 * `/integrations/gmail`), while landing pages use the hyphenated catalog slug, and the two differ
 * in more than spelling (`microsoft_ad` documents the `azure-ad` integration). Maps each docs slug
 * to its landing slug, so docs and landing links never guess one from the other.
 */
export const LANDING_SLUG_BY_DOCS_SLUG: ReadonlyMap<string, string> = new Map(
  INTEGRATION_METADATA.map((integration) => [
    integration.type.replace(/_v\d+$/, ''),
    integration.slug,
  ])
)

/** Every landing integration slug, i.e. every `/integrations/<slug>` page on the landing site. */
export const LANDING_INTEGRATION_SLUGS: ReadonlySet<string> = new Set(
  INTEGRATION_METADATA.map((integration) => integration.slug)
)
