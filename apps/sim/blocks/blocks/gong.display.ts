import { GongIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GongBlockDisplay = {
  type: 'gong',
  name: 'Gong',
  description: 'Revenue intelligence and conversation analytics',
  category: 'tools',
  bgColor: '#8039DF',
  icon: GongIcon,
  iconColor: '#8039DF',
  longDescription:
    'Integrate Gong into your workflow. Access call recordings, transcripts, user data, activity stats, scorecards, trackers, library content, coaching metrics, and more via the Gong API.',
  docsLink: 'https://docs.sim.ai/integrations/gong',
  integrationType: IntegrationType.Sales,
  triggerAllowed: true,
} satisfies BlockDisplay
