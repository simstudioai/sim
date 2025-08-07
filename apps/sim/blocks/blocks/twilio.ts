import { TwilioIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { TwilioSMSBlockOutput } from '@/tools/twilio/types'

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
      required: true,
    },
    {
      id: 'message',
      title: 'Message',
      type: 'long-input',
      layout: 'full',
      placeholder: 'e.g. "Hello! This is a test message."',
      required: true,
    },
    {
      id: 'accountSid',
      title: 'Twilio Account SID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your Twilio Account SID',
      required: true,
    },
    {
      id: 'authToken',
      title: 'Auth Token',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your Twilio Auth Token',
      password: true,
      required: true,
    },
    {
      id: 'fromNumber',
      title: 'From Twilio Phone Number',
      type: 'short-input',
      layout: 'full',
      placeholder: 'e.g. +1234567890',
      required: true,
    },
  ],
  tools: {
    access: ['twilio_send_sms'],
    config: {
      tool: () => 'twilio_send_sms',
    },
  },
  inputs: {
    phoneNumbers: { type: 'string', description: 'Recipient phone numbers' },
    message: { type: 'string', description: 'SMS message text' },
    accountSid: { type: 'string', description: 'Twilio account SID' },
    authToken: { type: 'string', description: 'Twilio auth token' },
    fromNumber: { type: 'string', description: 'Sender phone number' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Send success status' },
    messageId: { type: 'string', description: 'Twilio message SID' },
    status: { type: 'string', description: 'SMS delivery status (queued, sent, delivered, etc.)' },
    error: { type: 'string', description: 'Error information if sending fails' },
  },
}
