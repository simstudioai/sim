import { FathomIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const FathomBlockDisplay = {
  type: 'fathom',
  name: 'Fathom',
  description: 'Access meeting recordings, transcripts, and summaries',
  category: 'tools',
  bgColor: '#181C1E',
  icon: FathomIcon,
  longDescription:
    'Integrate Fathom AI Notetaker into your workflow. List meetings, get transcripts and summaries, and manage team members and teams. Can also trigger workflows when new meeting content is ready.',
  docsLink: 'https://docs.sim.ai/integrations/fathom',
  integrationType: IntegrationType.Analytics,
  triggerAllowed: true,
} satisfies BlockDisplay
