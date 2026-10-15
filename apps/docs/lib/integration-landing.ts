import { LANDING_SLUG_BY_DOCS_SLUG } from '@sim/deployment-config/integration-docs'
import { INTEGRATION_METADATA } from '@sim/deployment-config/integration-metadata'
import { SIM_SITE_URL } from '@/lib/urls'

/** Lead-in for the docs page's link to its landing page, shared by the HTML and markdown forms. */
export const INTEGRATION_LANDING_LABEL = 'Use cases and templates:'

const INTEGRATION_NAME_BY_LANDING_SLUG = new Map(
  INTEGRATION_METADATA.map((integration) => [integration.slug, integration.name])
)

/** The landing page a docs integration page (`/integrations/<docs slug>`) links to, if any. */
export function getIntegrationLandingPage(slugs: readonly string[] | undefined) {
  if (slugs?.length !== 2 || slugs[0] !== 'integrations') return undefined
  const landingSlug = LANDING_SLUG_BY_DOCS_SLUG.get(slugs[1])
  if (!landingSlug) return undefined
  const name = INTEGRATION_NAME_BY_LANDING_SLUG.get(landingSlug) ?? landingSlug
  return {
    title: `${name} integration for AI agents`,
    url: `${SIM_SITE_URL}/integrations/${landingSlug}`,
  }
}
