import { QuartrIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const QuartrBlockDisplay = {
  type: 'quartr',
  name: 'Quartr',
  description: 'Access earnings calls, transcripts, filings, and slides',
  category: 'tools',
  bgColor: '#000000',
  icon: QuartrIcon,
  longDescription:
    'Integrate Quartr into the workflow. Look up public companies, corporate events, and event types; fetch AI-generated event summaries; list and download filings, reports, slide decks, and transcripts; and access archived audio and live event streams. Requires API Key.',
  docsLink: 'https://docs.sim.ai/integrations/quartr',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay
