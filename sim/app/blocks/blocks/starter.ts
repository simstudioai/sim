import { StartIcon } from '@/components/icons'
import { ToolResponse } from '@/tools/types'
import { BlockConfig } from '../types'

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
    // Webhook configuration
    {
      id: 'webhookProvider',
      title: 'Webhook Provider',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Generic', id: 'generic' },
        { label: 'WhatsApp', id: 'whatsapp' },
        { label: 'GitHub', id: 'github' },
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
    // Common schedule fields for all frequency types
    {
      id: 'scheduleStartAt',
      title: 'Start At',
      type: 'date-input',
      layout: 'half',
      placeholder: 'Select day',
      condition: { field: 'startWorkflow', value: 'schedule' },
    },
    {
      id: 'scheduleTime',
      title: 'Time',
      type: 'time-input',
      layout: 'half',
      condition: { field: 'startWorkflow', value: 'schedule' },
    },
    // Frequency configuration
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
