import { ReductoIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ReductoBlockDisplay = {
  type: 'reducto',
  name: 'Reducto',
  description: 'Extract text from PDF documents',
  category: 'tools',
  bgColor: '#5c0c5c',
  icon: ReductoIcon,
  longDescription: `Integrate Reducto Parse into the workflow. Can extract text from uploaded PDF documents, or from a URL.`,
  docsLink: 'https://docs.sim.ai/integrations/reducto',
  integrationType: IntegrationType.AI,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const ReductoV2BlockDisplay = {
  ...ReductoBlockDisplay,
  type: 'reducto_v2',
  name: 'Reducto',
  longDescription: `Integrate Reducto Parse into the workflow. Can extract text from uploaded PDF documents or file references.`,
  hideFromToolbar: false,
} satisfies BlockDisplay
