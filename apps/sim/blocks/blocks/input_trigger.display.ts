import type { SVGProps } from 'react'
import { createElement } from 'react'
import { FormInput } from 'lucide-react'
import type { BlockDisplay } from '@/blocks/manifest'

const InputTriggerIcon = (props: SVGProps<SVGSVGElement>) => createElement(FormInput, props)

export const InputTriggerBlockDisplay = {
  type: 'input_trigger',
  name: 'Input Form (Legacy)',
  description: 'Legacy manual start block with structured input. Prefer Start block.',
  category: 'triggers',
  bgColor: '#3B82F6',
  icon: InputTriggerIcon,
  longDescription:
    'Manually trigger the workflow from the editor with a structured input schema. This enables typed inputs for parent workflows to map into.',
  hideFromToolbar: true,
  triggerAllowed: true,
} satisfies BlockDisplay
