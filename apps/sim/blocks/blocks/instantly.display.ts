import { InstantlyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const InstantlyBlockDisplay = {
  type: 'instantly',
  name: 'Instantly',
  description: 'Manage Instantly leads, campaigns, emails, and lead lists',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: InstantlyIcon,
  longDescription:
    'Integrate Instantly API V2 into workflows. Create and list leads, manage lead interest status, delete leads in bulk, list and create campaigns, reply to emails, and manage lead lists.',
  docsLink: 'https://docs.sim.ai/integrations/instantly',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay
