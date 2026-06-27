import type { SVGProps } from 'react'
import { createElement } from 'react'
import { PauseCircle } from 'lucide-react'
import type { BlockDisplay } from '@/blocks/manifest'

const WaitIcon = (props: SVGProps<SVGSVGElement>) => createElement(PauseCircle, props)

export const WaitBlockDisplay = {
  type: 'wait',
  name: 'Wait',
  description: 'Pause workflow execution for a time interval',
  category: 'blocks',
  bgColor: '#F59E0B',
  icon: WaitIcon,
  longDescription:
    'Pauses workflow execution for a specified time interval. By default the wait runs in-process for up to 5 minutes. Enable Async to pause the run on disk and resume automatically for waits up to 30 days.',
  docsLink: 'https://docs.sim.ai/workflows/blocks/wait',
} satisfies BlockDisplay
