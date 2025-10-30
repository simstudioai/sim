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
    {
      id: 'scheduleType',
      type: 'dropdown',
      title: 'Run frequency',
      options: [
        { label: 'Every X Minutes', id: 'minutes' },
        { label: 'Hourly', id: 'hourly' },
        { label: 'Daily', id: 'daily' },
        { label: 'Weekly', id: 'weekly' },
        { label: 'Monthly', id: 'monthly' },
        { label: 'Custom (Cron)', id: 'custom' },
      ],
      value: () => 'daily',
      required: true,
      mode: 'trigger',
    },

    {
      id: 'minutesInterval',
      type: 'short-input',
      title: 'Interval (minutes)',
      placeholder: '15',
      required: true,
      mode: 'trigger',
      condition: { field: 'scheduleType', value: 'minutes' },
    },

    {
      id: 'hourlyMinute',
      type: 'short-input',
      title: 'Minute',
      placeholder: '0-59',
      required: true,
      mode: 'trigger',
      condition: { field: 'scheduleType', value: 'hourly' },
    },

    {
      id: 'dailyTime',
      type: 'time-input',
      title: 'Time',
      required: true,
      mode: 'trigger',
      condition: { field: 'scheduleType', value: 'daily' },
    },

    {
      id: 'weeklyDay',
      type: 'dropdown',
      title: 'Day of week',
      options: [
        { label: 'Monday', id: 'MON' },
        { label: 'Tuesday', id: 'TUE' },
        { label: 'Wednesday', id: 'WED' },
        { label: 'Thursday', id: 'THU' },
        { label: 'Friday', id: 'FRI' },
        { label: 'Saturday', id: 'SAT' },
        { label: 'Sunday', id: 'SUN' },
      ],
      required: true,
      mode: 'trigger',
      condition: { field: 'scheduleType', value: 'weekly' },
    },

    {
      id: 'weeklyDayTime',
      type: 'time-input',
      title: 'Time',
      required: true,
      mode: 'trigger',
      condition: { field: 'scheduleType', value: 'weekly' },
    },

    {
      id: 'monthlyDay',
      type: 'short-input',
      title: 'Day of month',
      placeholder: '1-31',
      required: true,
      mode: 'trigger',
      condition: { field: 'scheduleType', value: 'monthly' },
    },

    {
      id: 'monthlyTime',
      type: 'time-input',
      title: 'Time',
      required: true,
      mode: 'trigger',
      condition: { field: 'scheduleType', value: 'monthly' },
    },

    {
      id: 'cronExpression',
      type: 'short-input',
      title: 'Cron expression',
      placeholder: '0 0 * * *',
      required: true,
      mode: 'trigger',
      condition: { field: 'scheduleType', value: 'custom' },
    },

    {
      id: 'timezone',
      type: 'dropdown',
      title: 'Timezone',
      options: [
        { label: 'UTC', id: 'UTC' },
        { label: 'US Eastern (UTC-5)', id: 'America/New_York' },
        { label: 'US Central (UTC-6)', id: 'America/Chicago' },
        { label: 'US Mountain (UTC-7)', id: 'America/Denver' },
        { label: 'US Pacific (UTC-8)', id: 'America/Los_Angeles' },
        { label: 'Mexico City (UTC-6)', id: 'America/Mexico_City' },
        { label: 'São Paulo (UTC-3)', id: 'America/Sao_Paulo' },
        { label: 'London (UTC+0)', id: 'Europe/London' },
        { label: 'Paris (UTC+1)', id: 'Europe/Paris' },
        { label: 'Berlin (UTC+1)', id: 'Europe/Berlin' },
        { label: 'Dubai (UTC+4)', id: 'Asia/Dubai' },
        { label: 'India (UTC+5:30)', id: 'Asia/Kolkata' },
        { label: 'Singapore (UTC+8)', id: 'Asia/Singapore' },
        { label: 'China (UTC+8)', id: 'Asia/Shanghai' },
        { label: 'Hong Kong (UTC+8)', id: 'Asia/Hong_Kong' },
        { label: 'Tokyo (UTC+9)', id: 'Asia/Tokyo' },
        { label: 'Sydney (UTC+10)', id: 'Australia/Sydney' },
        { label: 'Auckland (UTC+12)', id: 'Pacific/Auckland' },
      ],
      value: () => 'UTC',
      required: false,
      mode: 'trigger',
      condition: { field: 'scheduleType', value: ['minutes', 'hourly'], not: true },
    },

    {
      id: 'scheduleSave',
      type: 'schedule-save',
      mode: 'trigger',
    },

    {
      id: 'scheduleId',
      type: 'short-input',
      hidden: true,
      mode: 'trigger',
    },
  ],

  tools: {
    access: [], // No external tools needed
  },

  inputs: {}, // No inputs - schedule triggers initiate workflows

  outputs: {}, // No outputs - schedule triggers initiate workflow execution
}
