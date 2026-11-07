import { SIM_DOCS_URL } from '@sim/utils/site'
import { LIVE_SEARCH_SCOPE_FIELDS } from '@/lib/sim-search/live/policy-schema'

const CONNECT_ACCOUNT_GUIDE = `${SIM_DOCS_URL}/search/connect-your-account`

interface IntegrationGuideMetadata {
  setupGuideUrl?: string | null
  searchResource?: string | null
}

/**
 * The setup guide and search resource of a provider. A live-search provider newer than the generated
 * metadata still has its own guide page and scope label.
 */
export function integrationGuide(provider: string, metadata: IntegrationGuideMetadata | undefined) {
  const scope = LIVE_SEARCH_SCOPE_FIELDS[provider]
  return {
    setupGuideUrl:
      metadata?.setupGuideUrl ??
      (scope ? `${SIM_DOCS_URL}/search/${provider}` : CONNECT_ACCOUNT_GUIDE),
    searchResource: metadata?.searchResource ?? scope?.label ?? null,
  }
}
