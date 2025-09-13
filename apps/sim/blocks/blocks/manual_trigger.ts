import type { SVGProps } from 'react'
import { createElement } from 'react'
import { Play } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const ManualTriggerIcon = (props: SVGProps<SVGSVGElement>) => createElement(Play, props)

export const ManualTriggerBlock: BlockConfig = {
  type: 'manual_trigger',
  name: 'Manual Trigger',
  description: 'Run workflow manually from the editor',
  longDescription: 'Manual trigger to start the workflow during test runs.',
  category: 'triggers',
  bgColor: '#3B82F6',
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
