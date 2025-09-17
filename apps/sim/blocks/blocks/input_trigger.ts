import type { SVGProps } from 'react'
import { createElement } from 'react'
import { Play } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const InputTriggerIcon = (props: SVGProps<SVGSVGElement>) => createElement(Play, props)

export const InputTriggerBlock: BlockConfig = {
  type: 'input_trigger',
  name: 'Input Trigger',
  description: 'Start workflow manually with a defined input schema',
  longDescription:
    'Manually trigger the workflow from the editor with a structured input schema. This enables typed inputs for parent workflows to map into.',
  category: 'triggers',
  bgColor: '#3B82F6',
  icon: InputTriggerIcon,
  subBlocks: [
    {
      id: 'inputFormat',
      title: 'Input Format',
      type: 'input-format',
      layout: 'full',
      description: 'Define the JSON input schema for this workflow when run manually.',
    },
  ],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {
    // Dynamic outputs will be derived from inputFormat
  },
  triggers: {
    enabled: true,
    available: ['manual'],
  },
}
