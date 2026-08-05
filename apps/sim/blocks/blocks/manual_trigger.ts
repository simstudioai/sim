import { Play } from '@sim/emcn/icons'
import type { BlockConfig } from '@/blocks/types'

export const ManualTriggerBlock: BlockConfig = {
  type: 'manual_trigger',
  triggerAllowed: true,
  name: 'Manual (Legacy)',
  description: 'Legacy manual start block. Prefer the Start block.',
  longDescription:
    'Trigger the workflow manually without defining an input schema. Useful for simple runs where no structured input is needed.',
  bestPractices: `
  - Use when you want a simple manual start without defining an input format.
  - If you need structured inputs or child workflows to map variables from, prefer the Input Form Trigger.
  `,
  category: 'triggers',
  hideFromToolbar: true,
  sunset: { status: 'legacy', replacedBy: 'start_trigger' },
  bgColor: '#2563EB',
  icon: Play,
  subBlocks: [],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {},
  triggers: {
    enabled: true,
    available: ['manual'],
  },
}
