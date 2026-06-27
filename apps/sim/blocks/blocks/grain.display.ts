import { GrainIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GrainBlockDisplay = {
  type: 'grain',
  name: 'Grain',
  description: 'Access meeting recordings, transcripts, and AI summaries',
  category: 'tools',
  bgColor: '#F6FAF9',
  icon: GrainIcon,
  longDescription:
    'Integrate Grain into your workflow. Access meeting recordings, transcripts, highlights, and AI-generated summaries. Can also trigger workflows based on Grain webhook events.',
  docsLink: 'https://docs.sim.ai/integrations/grain',
  integrationType: IntegrationType.Productivity,
  triggerAllowed: true,
} satisfies BlockDisplay
