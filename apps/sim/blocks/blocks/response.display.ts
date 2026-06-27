import { ResponseIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const ResponseBlockDisplay = {
  type: 'response',
  name: 'Response',
  description: 'Send structured API response',
  category: 'blocks',
  bgColor: '#2F55FF',
  icon: ResponseIcon,
  longDescription:
    'Integrate Response into the workflow. Can send build or edit structured responses into a final workflow response.',
  docsLink: 'https://docs.sim.ai/workflows/blocks/response',
} satisfies BlockDisplay
