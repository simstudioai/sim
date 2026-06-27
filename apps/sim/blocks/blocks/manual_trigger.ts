import type { SVGProps } from 'react'
import { createElement } from 'react'
import { Play } from 'lucide-react'
import { ManualTriggerBlockDisplay } from '@/blocks/blocks/manual_trigger.display'
import type { BlockConfig } from '@/blocks/types'

const ManualTriggerIcon = (props: SVGProps<SVGSVGElement>) => createElement(Play, props)

export const ManualTriggerBlock: BlockConfig = {
  ...ManualTriggerBlockDisplay,
  bestPractices: `
  - Use when you want a simple manual start without defining an input format.
  - If you need structured inputs or child workflows to map variables from, prefer the Input Form Trigger.
  `,
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
