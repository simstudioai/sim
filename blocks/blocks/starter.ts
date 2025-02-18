import { StartIcon } from '@/components/icons'
import { BlockConfig } from '../types'

export const StarterBlock: BlockConfig = {
  type: 'starter',
  name: 'Starter',
  description: 'Start workflow',
  category: 'blocks',
  bgColor: '#2FB3FF',
  icon: StartIcon,
  subBlocks: [
    // Main trigger selector
    {
      id: 'startWorkflow',
      title: 'Start Workflow',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Run manually', id: 'manual' },
        { label: 'On webhook call', id: 'webhook' },
        { label: 'On schedule', id: 'schedule' },
      ],
      value: () => 'manual',
    },
    // Webhook configuration
    {
      id: 'webhookPath',
      title: 'Webhook Path',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter webhook path (e.g., /my-webhook)',
      condition: { field: 'startWorkflow', value: 'webhook' },
    },
    {
      id: 'webhookSecret',
      title: 'Webhook Secret',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter a secret key for webhook security',
      password: true,
      condition: { field: 'startWorkflow', value: 'webhook' },
    },
    // Schedule configuration
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
      condition: { field: 'startWorkflow', value: 'schedule' },
    },
    // Minutes schedule options
    {
      id: 'minutesInterval',
      title: 'Run Every',
      type: 'short-input',
      layout: 'full',
      placeholder: '15 minutes',
      condition: {
        field: 'scheduleType',
        value: 'minutes',
        and: {
          field: 'startWorkflow',
          value: 'schedule',
        },
      },
    },
    {
      id: 'minutesStartingAt',
      title: 'Starting At',
      type: 'short-input',
      layout: 'full',
      placeholder: '09:00',
      condition: {
        field: 'scheduleType',
        value: 'minutes',
        and: {
          field: 'startWorkflow',
          value: 'schedule',
        },
      },
    },
    // Hourly schedule options
    {
      id: 'hourlyMinute',
      title: 'Start at Minute',
      type: 'short-input',
      layout: 'full',
      placeholder: '00',
      condition: {
        field: 'scheduleType',
        value: 'hourly',
        and: {
          field: 'startWorkflow',
          value: 'schedule',
        },
      },
    },
    // Daily schedule options
    {
      id: 'dailyTime',
      title: 'Time',
      type: 'short-input',
      layout: 'full',
      placeholder: '09:00',
      condition: {
        field: 'scheduleType',
        value: 'daily',
        and: {
          field: 'startWorkflow',
          value: 'schedule',
        },
      },
    },
    // Weekly schedule options
    {
      id: 'weeklyDay',
      title: 'Day of Week',
      type: 'dropdown',
      layout: 'half',
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
      condition: {
        field: 'scheduleType',
        value: 'weekly',
        and: {
          field: 'startWorkflow',
          value: 'schedule',
        },
      },
    },
    {
      id: 'weeklyDayTime',
      title: 'Time',
      type: 'short-input',
      layout: 'half',
      placeholder: '09:00',
      condition: {
        field: 'scheduleType',
        value: 'weekly',
        and: {
          field: 'startWorkflow',
          value: 'schedule',
        },
      },
    },
    // Monthly schedule options
    {
      id: 'monthlyDay',
      title: 'Day of Month',
      type: 'short-input',
      layout: 'half',
      placeholder: '1',
      condition: {
        field: 'scheduleType',
        value: 'monthly',
        and: {
          field: 'startWorkflow',
          value: 'schedule',
        },
      },
    },
    {
      id: 'monthlyTime',
      title: 'Time',
      type: 'short-input',
      layout: 'half',
      placeholder: '09:00',
      condition: {
        field: 'scheduleType',
        value: 'monthly',
        and: {
          field: 'startWorkflow',
          value: 'schedule',
        },
      },
    },
    // Custom cron options
    {
      id: 'cronExpression',
      title: 'Cron Expression',
      type: 'short-input',
      layout: 'full',
      placeholder: '*/15 * * * *',
      condition: {
        field: 'scheduleType',
        value: 'custom',
        and: {
          field: 'startWorkflow',
          value: 'schedule',
        },
      },
    },
    // Timezone configuration (for all schedule types)
    {
      id: 'timezone',
      title: 'Timezone',
      type: 'dropdown',
      layout: 'full',
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
      condition: { field: 'startWorkflow', value: 'schedule' },
    },
  ],
  tools: {
    access: [],
  },
  inputs: {
    code: { type: 'string', required: true },
    executionMode: { type: 'string', required: true },
  },
  outputs: {
    response: {
      type: {
        result: 'any',
        stdout: 'string',
        executionTime: 'number',
      },
    },
  },
}
