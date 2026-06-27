import type { SVGProps } from 'react'
import { createElement } from 'react'
import { Play } from 'lucide-react'
import type { BlockDisplay } from '@/blocks/manifest'

const ManualTriggerIcon = (props: SVGProps<SVGSVGElement>) => createElement(Play, props)

export const ManualTriggerBlockDisplay = {
  type: 'manual_trigger',
  name: 'Manual (Legacy)',
  description: 'Legacy manual start block. Prefer the Start block.',
  category: 'triggers',
  bgColor: '#2563EB',
  icon: ManualTriggerIcon,
  longDescription:
    'Trigger the workflow manually without defining an input schema. Useful for simple runs where no structured input is needed.',
  hideFromToolbar: true,
  triggerAllowed: true,
} satisfies BlockDisplay
