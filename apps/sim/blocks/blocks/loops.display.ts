import { LoopsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const LoopsBlockDisplay = {
  type: 'loops',
  name: 'Loops',
  description: 'Manage contacts and send emails with Loops',
  category: 'tools',
  bgColor: '#FAFAF9',
  icon: LoopsIcon,
  longDescription:
    'Integrate Loops into the workflow. Create and manage contacts, send transactional emails, and trigger event-based automations.',
  docsLink: 'https://docs.sim.ai/integrations/loops',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay
