import { LumaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const LumaBlockDisplay = {
  type: 'luma',
  name: 'Luma',
  description: 'Manage events and guests on Luma',
  category: 'tools',
  bgColor: '#000000',
  icon: LumaIcon,
  longDescription:
    'Integrate Luma into the workflow. Can create, update, look up, and cancel events, list calendar events, manage guest lists (get one or many, add guests, send invites, and update approval status).',
  docsLink: 'https://docs.sim.ai/integrations/luma',
  integrationType: IntegrationType.Productivity,
} satisfies BlockDisplay
