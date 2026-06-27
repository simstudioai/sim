import { ApiIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const ApiTriggerBlockDisplay = {
  type: 'api_trigger',
  name: 'API (Legacy)',
  description: 'Legacy block for exposing HTTP API endpoint. Prefer Start block.',
  category: 'triggers',
  bgColor: '#2F55FF',
  icon: ApiIcon,
  longDescription:
    'API trigger to start the workflow via authenticated HTTP calls with structured input.',
  hideFromToolbar: true,
  triggerAllowed: true,
} satisfies BlockDisplay
