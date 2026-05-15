import type { SVGProps } from 'react'
import { createElement } from 'react'
import { PauseCircle } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const WaitIcon = (props: SVGProps<SVGSVGElement>) => createElement(PauseCircle, props)

export const WaitBlock: BlockConfig = {
  type: 'wait',
  name: 'Wait',
  description: 'Pause workflow execution for a time interval',
  longDescription:
    'Pauses workflow execution for a specified time interval. By default the wait runs in-process for up to 5 minutes. Enable Async to pause the run on disk and resume automatically for waits up to 30 days.',
  bestPractices: `
  - Configure the wait amount and unit
  - Default mode runs in-process and caps at 5 minutes
  - Enable Async for longer waits (up to 30 days); seconds are not available in this mode
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
      description: 'Max 5 minutes (300 seconds). Enable Async for up to 30 days.',
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
      condition: { field: 'async', value: true, not: true },
    },
    {
      id: 'timeUnitLong',
      title: 'Unit',
      type: 'dropdown',
      options: [
        { label: 'Minutes', id: 'minutes' },
        { label: 'Hours', id: 'hours' },
        { label: 'Days', id: 'days' },
      ],
      value: () => 'minutes',
      required: true,
      condition: { field: 'async', value: true },
    },
    {
      id: 'async',
      title: 'Async',
      type: 'switch',
    },
  ],
  tools: {
    access: [],
  },
  inputs: {
    async: {
      type: 'boolean',
      description: 'Run the wait asynchronously to allow durations up to 30 days',
    },
    timeValue: {
      type: 'string',
      description: 'Wait duration value',
    },
    timeUnit: {
      type: 'string',
      description: 'Wait duration unit when async is off (seconds or minutes)',
    },
    timeUnitLong: {
      type: 'string',
      description: 'Wait duration unit when async is on (minutes, hours, or days)',
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
