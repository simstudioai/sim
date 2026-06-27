import { KetchIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const KetchBlockDisplay = {
  type: 'ketch',
  name: 'Ketch',
  description: 'Manage privacy consent, subscriptions, and data subject rights',
  category: 'tools',
  bgColor: '#9B5CFF',
  icon: KetchIcon,
  longDescription:
    'Integrate Ketch into the workflow. Retrieve and update consent preferences, manage subscription topics and controls, and submit data subject rights requests for access, deletion, correction, or processing restriction.',
  docsLink: 'https://docs.sim.ai/integrations/ketch',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay
