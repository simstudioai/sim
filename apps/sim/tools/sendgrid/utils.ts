import { defineCredentialRegions } from '@/tools/shared/credential-regions'

/**
 * SendGrid's v3 API hosts: global users and subusers call api.sendgrid.com, and regional subusers
 * in the EU call api.eu.sendgrid.com. Marketing Campaigns features are not available to EU
 * subusers. See https://www.twilio.com/docs/sendgrid/api-reference/mail-send and
 * https://www.twilio.com/docs/sendgrid/data-residency/faq
 */
export const SENDGRID_REGIONS = defineCredentialRegions({
  service: 'SendGrid',
  noun: 'region',
  regions: {
    global: { origin: 'https://api.sendgrid.com', label: 'Global (api.sendgrid.com)' },
    eu: { origin: 'https://api.eu.sendgrid.com', label: 'EU subuser (api.eu.sendgrid.com)' },
  },
  defaultRegion: 'global',
  basePath: '/v3',
})
