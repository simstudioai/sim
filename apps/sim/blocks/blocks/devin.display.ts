import { DevinIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const DevinBlockDisplay = {
  type: 'devin',
  name: 'Devin',
  description: 'Autonomous AI software engineer',
  category: 'tools',
  bgColor: '#12141A',
  icon: DevinIcon,
  longDescription:
    'Integrate Devin into your workflow. Create sessions to assign coding tasks, send messages to guide active sessions, and retrieve session status and results. Devin autonomously writes, runs, and tests code.',
  docsLink: 'https://docs.sim.ai/integrations/devin',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay
