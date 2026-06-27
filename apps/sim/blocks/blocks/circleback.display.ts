import { CirclebackIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const CirclebackBlockDisplay = {
  type: 'circleback',
  name: 'Circleback',
  description: 'AI-powered meeting notes and action items',
  category: 'triggers',
  bgColor: 'linear-gradient(180deg, #E0F7FA 0%, #FFFFFF 100%)',
  icon: CirclebackIcon,
  longDescription:
    'Receive meeting notes, action items, transcripts, and recordings when meetings are processed. Circleback uses webhooks to push data to your workflows.',
  docsLink: 'https://docs.sim.ai/integrations/circleback',
  integrationType: IntegrationType.AI,
  triggerAllowed: true,
} satisfies BlockDisplay
