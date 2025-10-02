import type { SVGProps } from 'react'
import { createElement } from 'react'
import { Play } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const ManualTriggerIcon = (props: SVGProps<SVGSVGElement>) => createElement(Play, props)

export const ManualTriggerBlock: BlockConfig = {
  type: 'manual_trigger',
  triggerAllowed: true,
  name: 'Manual',
  description: 'Start workflow manually from the editor',
  longDescription:
    'Trigger the workflow manually without defining an input schema. Useful for simple runs where no structured input is needed.',
  bestPractices: `
  - Use when you want a simple manual start without defining an input format.
  - If you need structured inputs or child workflows to map variables from, prefer the Input Form Trigger.
  `,
  category: 'triggers',
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
