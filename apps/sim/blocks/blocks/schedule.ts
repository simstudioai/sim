import { ScheduleIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const ScheduleBlock: BlockConfig = {
  type: 'schedule',
  name: 'Schedule',
  description: 'Trigger workflow execution on a schedule',
  longDescription:
    'Integrate Schedule into the workflow. Can trigger a workflow on a schedule configuration.',
  category: 'triggers',
  bgColor: '#7B68EE',
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
