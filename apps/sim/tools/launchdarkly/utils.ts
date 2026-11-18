import { defineCredentialRegions } from '@/tools/shared/credential-regions'

/**
 * LaunchDarkly instances and the base URI each one's REST API answers on. An access token is
 * created in, and only works on, one instance. Commercial is the default; EU and federal
 * accounts use their own hosts. See https://launchdarkly.com/docs/api
 */
export const LAUNCHDARKLY_INSTANCES = defineCredentialRegions({
  service: 'LaunchDarkly',
  noun: 'instance',
  regions: {
    us: { origin: 'https://app.launchdarkly.com', label: 'Commercial (app.launchdarkly.com)' },
    eu: { origin: 'https://app.eu.launchdarkly.com', label: 'EU (app.eu.launchdarkly.com)' },
    federal: { origin: 'https://app.launchdarkly.us', label: 'Federal (app.launchdarkly.us)' },
  },
  defaultRegion: 'us',
  basePath: '/api/v2',
})
