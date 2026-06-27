import { StartIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const StartTriggerBlockDisplay = {
  type: 'start_trigger',
  name: 'Start',
  description: 'Unified workflow entry point for chat, manual and API runs',
  category: 'triggers',
  bgColor: '#34B5FF',
  icon: StartIcon,
  longDescription:
    'Collect structured inputs and power manual runs, API executions, and deployed chat experiences from a single start block.',
  docsLink: 'https://docs.sim.ai/workflows/triggers/start',
  hideFromToolbar: false,
  triggerAllowed: true,
} satisfies BlockDisplay
