import type { SVGProps } from 'react'
import { createElement } from 'react'
import { PauseCircle } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const WaitIcon = (props: SVGProps<SVGSVGElement>) => createElement(PauseCircle, props)

export const WaitBlock: BlockConfig = {
  type: 'wait',
  name: 'Wait',
  description: 'Pause workflow execution for a specified time delay',
  longDescription:
    'Pauses workflow execution for a specified time interval. The wait executes a simple sleep for the configured duration.',
  bestPractices: `
  - Use for simple time delays (max 10 minutes)
  - Configure the wait amount and unit (seconds or minutes)
  - Time-based waits are interruptible via workflow cancellation
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
      description: 'Max: 600 seconds or 10 minutes',
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
      description: 'Wait duration unit (seconds or minutes)',
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
  },
}
