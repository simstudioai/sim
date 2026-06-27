import { StagehandIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const StagehandBlockDisplay = {
  type: 'stagehand',
  name: 'Stagehand',
  description: 'Web automation and data extraction',
  category: 'tools',
  bgColor: '#FFC83C',
  icon: StagehandIcon,
  longDescription:
    'Integrate Stagehand into the workflow. Can extract structured data from webpages or run an autonomous agent to perform tasks.',
  docsLink: 'https://docs.sim.ai/integrations/stagehand',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay
