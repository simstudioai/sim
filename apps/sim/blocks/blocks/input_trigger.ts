import type { SVGProps } from 'react'
import { createElement } from 'react'
import { FormInput } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const InputTriggerIcon = (props: SVGProps<SVGSVGElement>) => createElement(FormInput, props)

export const InputTriggerBlock: BlockConfig = {
  type: 'input_trigger',
  triggerAllowed: true,
  name: 'Input Form (Legacy)',
  description: 'Legacy manual start block with structured input. Prefer Start block.',
  longDescription:
    'Manually trigger the workflow from the editor with a structured input schema. This enables typed inputs for parent workflows to map into.',
  bestPractices: `
  - Can run the workflow manually to test implementation when this is the trigger point.
  - The input format determines variables accesssible in the following blocks. E.g. <input1.paramName>. You can set the value in the input format to test the workflow manually.
  - Also used in child workflows to map variables from the parent workflow.
  `,
  category: 'triggers',
  hideFromToolbar: true,
  bgColor: '#3B82F6',
  icon: InputTriggerIcon,
  subBlocks: [
    {
      id: 'inputFormat',
      title: 'Input Format',
      type: 'input-format',
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
