import { RevenueCatIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const RevenueCatBlockDisplay = {
  type: 'revenuecat',
  name: 'RevenueCat',
  description: 'Manage in-app subscriptions and entitlements',
  category: 'tools',
  bgColor: '#F25A5A',
  icon: RevenueCatIcon,
  iconColor: '#F25A5A',
  longDescription:
    'Integrate RevenueCat into the workflow. Manage subscribers, entitlements, offerings, and Google Play subscriptions. Retrieve customer subscription status, grant or revoke promotional entitlements, record purchases, update subscriber attributes, and manage Google Play subscription billing.',
  docsLink: 'https://docs.sim.ai/integrations/revenuecat',
  integrationType: IntegrationType.Commerce,
} satisfies BlockDisplay
