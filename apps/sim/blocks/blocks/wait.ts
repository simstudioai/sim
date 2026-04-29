import type { SVGProps } from 'react'
import { createElement } from 'react'
import { PauseCircle } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const WaitIcon = (props: SVGProps<SVGSVGElement>) => createElement(PauseCircle, props)

export const WaitBlock: BlockConfig = {
  type: 'wait',
  name: 'Wait',
  description: 'Pause workflow execution for up to 30 days',
  longDescription:
    'Pauses workflow execution for a specified time interval. Waits up to five minutes are held in-process; longer waits suspend the workflow and resume automatically once the configured duration elapses.',
  bestPractices: `
  - Configure the wait amount and unit (seconds, minutes, hours, or days)
  - Maximum wait duration is 30 days
  - Waits up to 5 minutes execute in-process and are interruptible via workflow cancellation
  - Longer waits suspend the workflow; the execution resumes automatically when the timer fires
  - Enter a positive number for the wait amount
  `,
  category: 'blocks',
  bgColor: '#F59E0B',
  icon: WaitIcon,
  docsLink: 'https://docs.sim.ai/blocks/wait',
  subBlocks: [
    {
      id: 'timeValue',
      title: 'Wait Amount',
      type: 'short-input',
      description: 'Max: 30 days',
      placeholder: '10',
      value: () => '10',
      required: true,
    },
    {
      id: 'timeUnit',
      title: 'Unit',
      type: 'dropdown',
      options: [
        { label: 'Seconds', id: 'seconds' },
        { label: 'Minutes', id: 'minutes' },
        { label: 'Hours', id: 'hours' },
        { label: 'Days', id: 'days' },
      ],
      value: () => 'seconds',
      required: true,
    },
  ],
  tools: {
    access: [],
  },
  inputs: {
    timeValue: {
      type: 'string',
      description: 'Wait duration value',
    },
    timeUnit: {
      type: 'string',
      description: 'Wait duration unit (seconds, minutes, hours, or days)',
    },
  },
  outputs: {
    waitDuration: {
      type: 'number',
      description: 'Wait duration in milliseconds',
    },
    status: {
      type: 'string',
      description: 'Status of the wait block (waiting, completed, cancelled)',
    },
    resumeAt: {
      type: 'string',
      description: 'ISO timestamp at which a suspended wait will resume (long waits only)',
    },
  },
}
