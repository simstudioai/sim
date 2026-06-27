import { GranolaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GranolaBlockDisplay = {
  type: 'granola',
  name: 'Granola',
  description: 'Access meeting notes and transcripts from Granola',
  category: 'tools',
  bgColor: '#B2C147',
  icon: GranolaIcon,
  longDescription:
    'Integrate Granola into your workflow to retrieve meeting notes, summaries, attendees, and transcripts.',
  docsLink: 'https://docs.sim.ai/integrations/granola',
  integrationType: IntegrationType.Productivity,
} satisfies BlockDisplay
