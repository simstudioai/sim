import type { SVGProps } from 'react'
import { createElement } from 'react'
import { FormInput } from 'lucide-react'
import { InputTriggerBlockDisplay } from '@/blocks/blocks/input_trigger.display'
import type { BlockConfig } from '@/blocks/types'

const InputTriggerIcon = (props: SVGProps<SVGSVGElement>) => createElement(FormInput, props)

export const InputTriggerBlock: BlockConfig = {
  ...InputTriggerBlockDisplay,
  bestPractices: `
  - Can run the workflow manually to test implementation when this is the trigger point.
  - The input format determines variables accesssible in the following blocks. E.g. <input1.paramName>. You can set the value in the input format to test the workflow manually.
  - Also used in child workflows to map variables from the parent workflow.
  `,
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
