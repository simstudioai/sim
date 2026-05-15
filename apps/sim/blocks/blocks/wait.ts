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
    'Pauses workflow execution for a specified time interval. By default the wait runs in-process for up to 5 minutes. Enable Suspend Workflow to pause the run on disk and resume automatically for waits up to 30 days.',
  bestPractices: `
  - Configure the wait amount and unit
  - Default mode runs in-process and caps at 5 minutes
  - Enable Suspend Workflow for longer waits (up to 30 days); seconds are not available in this mode
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
      condition: { field: 'suspend', value: true, not: true },
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
      condition: { field: 'suspend', value: true },
    },
    {
      id: 'suspend',
      title: 'Suspend Workflow',
      type: 'switch',
      tooltip:
        'By default, the workflow pauses in memory and can wait up to 5 minutes. Turn this on to suspend the run to disk so it can wait much longer (up to 30 days) — execution resumes automatically when the timer fires. Seconds aren’t available while suspended.',
    },
  ],
  tools: {
    access: [],
  },
  inputs: {
    suspend: {
      type: 'boolean',
      description: 'Suspend the workflow to allow waits up to 30 days',
    },
    timeValue: {
      type: 'string',
      description: 'Wait duration value',
    },
    timeUnit: {
      type: 'string',
      description: 'Wait duration unit when suspend is off (seconds or minutes)',
    },
    timeUnitLong: {
      type: 'string',
      description: 'Wait duration unit when suspend is on (minutes, hours, or days)',
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
