import type { SVGProps } from 'react'
import { createElement } from 'react'
import { Play } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const ManualTriggerIcon = (props: SVGProps<SVGSVGElement>) => createElement(Play, props)

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
  bgColor: '#2563EB',
  icon: ManualTriggerIcon,
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
