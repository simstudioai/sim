import { GoogleAdsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GoogleAdsBlockDisplay = {
  type: 'google_ads',
  name: 'Google Ads',
  description: 'Query campaigns, ad groups, and performance metrics',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleAdsIcon,
  longDescription:
    'Connect to Google Ads to list accessible accounts, list campaigns, view ad group details, get performance metrics, and run custom GAQL queries.',
  docsLink: 'https://docs.sim.ai/integrations/google_ads',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay
