import { WizaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const WizaBlockDisplay = {
  type: 'wiza',
  name: 'Wiza',
  description: 'Find, enrich, and verify B2B contact data with Wiza',
  category: 'tools',
  bgColor: '#9284BC',
  icon: WizaIcon,
  iconColor: '#9284BC',
  longDescription:
    'Integrates Wiza into the workflow. Search prospects, enrich companies, reveal verified emails and phone numbers for individuals, and check your account credit balance.',
  docsLink: 'https://docs.sim.ai/integrations/wiza',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay
