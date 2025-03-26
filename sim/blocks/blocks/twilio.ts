import { TwilioIcon } from '@/components/icons'
import { ToolResponse } from '@/tools/types'
import { BlockCategory, BlockConfig, BlockIcon } from '../types'

interface TwilioSMSBlockOutput extends ToolResponse {
  output: {
    success: boolean
    messageId?: string
    status?: string
    error?: string
  }
}

export const TwilioSMSBlock: BlockConfig<TwilioSMSBlockOutput> = {
  type: 'twilio_sms',
  name: 'Twilio SMS',
  description: 'Send SMS messages via Twilio',
  longDescription: 
    'Send text messages to single or multiple recipients using the Twilio API. Supports message templates and delivery status tracking.',
  category: 'tools',
  bgColor: '#F22F46', // Twilio brand color
  icon: TwilioIcon,
  subBlocks: [
    {
      id: 'phoneNumbers',
      title: 'Recipient Phone Numbers',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter phone numbers with country code (one per line, e.g., +1234567890)',
    },
    {
      id: 'message',
      title: 'Message',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter your message or use template variables like {{input.name}}',
    },
    {
      id: 'accountSid',
      title: 'Twilio Account SID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your Twilio Account SID',
    },
    {
      id: 'authToken',
      title: 'Auth Token',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your Twilio Auth Token',
      password: true,
    },
    {
      id: 'fromNumber',
      title: 'From Phone Number',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your Twilio phone number (with country code)',
    }
  ],
  tools: {
    access: ['twilio_send_sms'],
    config: {
      tool: () => 'twilio_send_sms',
    },
  },
  inputs: {
    phoneNumbers: { type: 'string', required: true },
    message: { type: 'string', required: true },
    accountSid: { type: 'string', required: true },
    authToken: { type: 'string', required: true },
    fromNumber: { type: 'string', required: true }
  },
  outputs: {
    response: {
      type: {
        success: 'boolean',
        messageId: 'string',
        status: 'string',
        error: 'string'
      },
    },
  },
} 