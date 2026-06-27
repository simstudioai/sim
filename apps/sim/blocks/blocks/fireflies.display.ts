import { FirefliesIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const FirefliesBlockDisplay = {
  type: 'fireflies',
  name: 'Fireflies (Legacy)',
  description: 'Interact with Fireflies.ai meeting transcripts and recordings',
  category: 'tools',
  bgColor: '#100730',
  icon: FirefliesIcon,
  longDescription:
    'Integrate Fireflies.ai into the workflow. Manage meeting transcripts, add bot to live meetings, create soundbites, and more. Can also trigger workflows when transcriptions complete.',
  docsLink: 'https://docs.sim.ai/integrations/fireflies',
  integrationType: IntegrationType.Productivity,
  hideFromToolbar: true,
  triggerAllowed: true,
} satisfies BlockDisplay

export const FirefliesV2BlockDisplay = {
  ...FirefliesBlockDisplay,
  type: 'fireflies_v2',
  name: 'Fireflies',
  description: 'Interact with Fireflies.ai meeting transcripts and recordings',
  integrationType: IntegrationType.Productivity,
  hideFromToolbar: false,
} satisfies BlockDisplay
