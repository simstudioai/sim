import { StartIcon } from '@/components/icons'
import type { ToolResponse } from '@/tools/types'
import type { BlockConfig } from '../types'

interface StarterBlockOutput extends ToolResponse {
  output: {
    input: any
  }
}

export const StarterBlock: BlockConfig<StarterBlockOutput> = {
  type: 'starter',
  name: 'Starter',
  description: 'Start workflow',
  longDescription:
    'Initiate your workflow manually, on a schedule, or via webhook triggers. Configure flexible execution patterns with customizable timing options and webhook security.',
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
    // Structured Input format - visible if manual run is selected
    // {
    //   id: 'inputFormat',
    //   title: 'Input Format (for API calls)',
    //   type: 'input-format',
    //   layout: 'full',
    //   condition: { field: 'startWorkflow', value: 'manual' },
    // },
    // Webhook configuration
    {
      id: 'webhookProvider',
      title: 'Webhook Provider',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Slack', id: 'slack' },
        { label: 'Gmail', id: 'gmail' },
        { label: 'Airtable', id: 'airtable' },
        { label: 'Telegram', id: 'telegram' },
        { label: 'Generic', id: 'generic' },
        // { label: 'WhatsApp', id: 'whatsapp' },
        // { label: 'GitHub', id: 'github' },
        // { label: 'Discord', id: 'discord' },
        // { label: 'Stripe', id: 'stripe' },
      ],
      value: () => 'generic',
      condition: { field: 'startWorkflow', value: 'webhook' },
    },
    {
      id: 'webhookConfig',
      title: 'Webhook Configuration',
      type: 'webhook-config',
      layout: 'full',
      condition: { field: 'startWorkflow', value: 'webhook' },
    },
    // Schedule configuration status display
    {
      id: 'scheduleConfig',
      title: 'Schedule Status',
      type: 'schedule-config',
      layout: 'full',
      condition: { field: 'startWorkflow', value: 'schedule' },
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
      condition: { field: 'startWorkflow', value: 'schedule' },
    },
    {
      id: 'scheduleStartAt',
      type: 'date-input',
      hidden: true,
      condition: { field: 'startWorkflow', value: 'schedule' },
    },
    {
      id: 'scheduleTime',
      type: 'time-input',
      hidden: true,
      condition: { field: 'startWorkflow', value: 'schedule' },
    },
    {
      id: 'minutesInterval',
      type: 'short-input',
      hidden: true,
      condition: { field: 'startWorkflow', value: 'schedule' },
    },
    {
      id: 'hourlyMinute',
      type: 'short-input',
      hidden: true,
      condition: { field: 'startWorkflow', value: 'schedule' },
    },
    {
      id: 'dailyTime',
      type: 'short-input',
      hidden: true,
      condition: { field: 'startWorkflow', value: 'schedule' },
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
      condition: { field: 'startWorkflow', value: 'schedule' },
    },
    {
      id: 'weeklyDayTime',
      type: 'short-input',
      hidden: true,
      condition: { field: 'startWorkflow', value: 'schedule' },
    },
    {
      id: 'monthlyDay',
      type: 'short-input',
      hidden: true,
      condition: { field: 'startWorkflow', value: 'schedule' },
    },
    {
      id: 'monthlyTime',
      type: 'short-input',
      hidden: true,
      condition: { field: 'startWorkflow', value: 'schedule' },
    },
    {
      id: 'cronExpression',
      type: 'short-input',
      hidden: true,
      condition: { field: 'startWorkflow', value: 'schedule' },
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
      condition: { field: 'startWorkflow', value: 'schedule' },
    },
  ],
  tools: {
    access: [],
  },
  inputs: {
    input: { type: 'json', required: false },
  },
  outputs: {
    response: {
      type: {
        input: 'any',
      },
    },
  },
}
