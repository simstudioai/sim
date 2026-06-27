import { GammaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GammaBlockDisplay = {
  type: 'gamma',
  name: 'Gamma',
  description: 'Generate presentations, documents, and webpages with AI',
  category: 'tools',
  bgColor: '#002253',
  icon: GammaIcon,
  longDescription:
    'Integrate Gamma into the workflow. Can generate presentations, documents, webpages, and social posts from text, create from templates, check generation status, and browse themes and folders.',
  docsLink: 'https://docs.sim.ai/integrations/gamma',
  integrationType: IntegrationType.Marketing,
} satisfies BlockDisplay
