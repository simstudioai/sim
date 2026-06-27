import { AsanaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const AsanaBlockDisplay = {
  type: 'asana',
  name: 'Asana',
  description: 'Interact with Asana',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: AsanaIcon,
  longDescription: 'Integrate Asana into the workflow. Can read, write, and update tasks.',
  docsLink: 'https://docs.sim.ai/integrations/asana',
  integrationType: IntegrationType.Productivity,
} satisfies BlockDisplay
