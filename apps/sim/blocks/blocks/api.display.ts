import { ApiIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ApiBlockDisplay = {
  type: 'api',
  name: 'API',
  description: 'Use any API',
  category: 'blocks',
  bgColor: '#2F55FF',
  icon: ApiIcon,
  longDescription:
    'This is a core workflow block. Connect to any external API with support for all standard HTTP methods and customizable request parameters. Configure headers, query parameters, and request bodies. Standard headers (User-Agent, Accept, Cache-Control, etc.) are automatically included.',
  docsLink: 'https://docs.sim.ai/workflows/blocks/api',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay
