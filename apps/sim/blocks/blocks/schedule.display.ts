import type { SVGProps } from 'react'
import { createElement } from 'react'
import { Clock } from 'lucide-react'
import type { BlockDisplay } from '@/blocks/manifest'

const ScheduleIcon = (props: SVGProps<SVGSVGElement>) => createElement(Clock, props)

export const ScheduleBlockDisplay = {
  type: 'schedule',
  name: 'Schedule',
  description: 'Trigger workflow execution on a schedule',
  category: 'triggers',
  bgColor: '#6366F1',
  icon: ScheduleIcon,
  longDescription:
    'Integrate Schedule into the workflow. Can trigger a workflow on a schedule configuration.',
  docsLink: 'https://docs.sim.ai/workflows/triggers/schedule',
  triggerAllowed: true,
} satisfies BlockDisplay
