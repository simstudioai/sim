import { defineCredentialRegions } from '@/tools/shared/credential-regions'

/**
 * Sentry's SaaS API hosts per data storage location: sentry.io for organizations whose data is
 * stored in the US, and de.sentry.io for the EU, which keeps API requests inside the selected
 * location. See https://docs.sentry.io/api/ and
 * https://docs.sentry.io/organization/data-storage-location/
 */
export const SENTRY_REGIONS = defineCredentialRegions({
  service: 'Sentry',
  noun: 'data storage region',
  regions: {
    us: { origin: 'https://sentry.io', label: 'US (sentry.io)' },
    de: { origin: 'https://de.sentry.io', label: 'EU (de.sentry.io)' },
  },
  defaultRegion: 'us',
  basePath: '/api/0',
})
