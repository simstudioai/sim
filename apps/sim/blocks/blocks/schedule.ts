import type { SVGProps } from 'react'
import { createElement } from 'react'
import { Clock } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const ScheduleIcon = (props: SVGProps<SVGSVGElement>) => createElement(Clock, props)

export const ScheduleBlock: BlockConfig = {
  type: 'schedule',
  triggerAllowed: true,
  name: 'Schedule',
  description: 'Trigger workflow execution on a schedule',
  longDescription:
    'Integrate Schedule into the workflow. Can trigger a workflow on a schedule configuration.',
  bestPractices: `
  - Search up examples with schedule blocks to understand YAML syntax. 
  - Prefer the custom cron expression input method over the other schedule configuration methods. 
  - Clarify the timezone if the user doesn't specify it.
  `,
  category: 'triggers',
  bgColor: '#6366F1',
  icon: ScheduleIcon,

  subBlocks: [
    // Schedule configuration status display
    {
      id: 'scheduleConfig',
      title: 'Schedule Status',
      type: 'schedule-config',
      layout: 'full',
    },
    // Hidden fields for schedule configuration (used by the modal only)
    {
      id: 'scheduleType',
      title: 'Frequency',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Every X Minutes', id: 'minutes' },
        { label: 'Hourly', id: 'hourly' },
        { label: 'Daily', id: 'daily' },
        { label: 'Weekly', id: 'weekly' },
        { label: 'Monthly', id: 'monthly' },
        { label: 'Custom Cron', id: 'custom' },
      ],
      value: () => 'daily',
      hidden: true,
    },
    {
      id: 'minutesInterval',
      type: 'short-input',
      hidden: true,
    },
    {
      id: 'hourlyMinute',
      type: 'short-input',
      hidden: true,
    },
    {
      id: 'dailyTime',
      type: 'short-input',
      hidden: true,
    },
    {
      id: 'weeklyDay',
      type: 'dropdown',
      hidden: true,
      options: [
        { label: 'Monday', id: 'MON' },
        { label: 'Tuesday', id: 'TUE' },
        { label: 'Wednesday', id: 'WED' },
        { label: 'Thursday', id: 'THU' },
        { label: 'Friday', id: 'FRI' },
        { label: 'Saturday', id: 'SAT' },
        { label: 'Sunday', id: 'SUN' },
      ],
      value: () => 'MON',
    },
    {
      id: 'weeklyDayTime',
      type: 'short-input',
      hidden: true,
    },
    {
      id: 'monthlyDay',
      type: 'short-input',
      hidden: true,
    },
    {
      id: 'monthlyTime',
      type: 'short-input',
      hidden: true,
    },
    {
      id: 'cronExpression',
      type: 'short-input',
      hidden: true,
    },
    {
      id: 'timezone',
      type: 'dropdown',
      hidden: true,
      options: [
        { label: 'UTC', id: 'UTC' },
        { label: 'US Eastern (UTC-4)', id: 'America/New_York' },
        { label: 'US Central (UTC-5)', id: 'America/Chicago' },
        { label: 'US Mountain (UTC-6)', id: 'America/Denver' },
        { label: 'US Pacific (UTC-7)', id: 'America/Los_Angeles' },
        { label: 'London (UTC+1)', id: 'Europe/London' },
        { label: 'Paris (UTC+2)', id: 'Europe/Paris' },
        { label: 'Singapore (UTC+8)', id: 'Asia/Singapore' },
        { label: 'Tokyo (UTC+9)', id: 'Asia/Tokyo' },
        { label: 'Sydney (UTC+10)', id: 'Australia/Sydney' },
      ],
      value: () => 'UTC',
    },
  ],

  tools: {
    access: [], // No external tools needed
  },

  inputs: {}, // No inputs - schedule triggers initiate workflows

  outputs: {}, // No outputs - schedule triggers initiate workflow execution
}
