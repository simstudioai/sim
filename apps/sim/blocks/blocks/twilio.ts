import { TwilioIcon } from '@/components/icons'
import type { TwilioSMSBlockOutput } from '@/tools/twilio/types'
import type { BlockConfig } from '../types'

export const TwilioSMSBlock: BlockConfig<TwilioSMSBlockOutput> = {
  type: 'twilio_sms',
  name: 'Twilio SMS',
  description: 'Send SMS messages',
  longDescription: 'Send text messages to single or multiple recipients using the Twilio API.',
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
      placeholder: 'e.g. "Hello! This is a test message."',
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
      title: 'From Twilio Phone Number',
      type: 'short-input',
      layout: 'full',
      placeholder: 'e.g. +1234567890',
    },
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
    fromNumber: { type: 'string', required: true },
  },
  outputs: {
    response: {
      type: {
        success: 'boolean',
        messageId: 'any',
        status: 'any',
        error: 'any',
      },
    },
  },
}
