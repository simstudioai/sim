import { TwilioIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'
import { getTrigger } from '@/triggers'

export const TwilioVoiceBlock: BlockConfig<ToolResponse> = {
  type: 'twilio_voice',
  name: 'Twilio Voice',
  description: 'Make and manage phone calls',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Twilio Voice into the workflow. Make outbound calls and retrieve call recordings.',
  category: 'tools',
  bgColor: '#F22F46', // Twilio brand color
  icon: TwilioIcon,
  triggerAllowed: true,
  subBlocks: [
    ...getTrigger('twilio_voice_webhook').subBlocks,
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Make Call', id: 'make_call' },
        { label: 'Get Recording', id: 'get_recording' },
      ],
      value: () => 'make_call',
    },
    // Common credentials
    {
      id: 'accountSid',
      title: 'Twilio Account SID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
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
    // Make Call fields
    {
      id: 'to',
      title: 'To Phone Number',
      type: 'short-input',
      layout: 'half',
      placeholder: '+14155551234',
      condition: {
        field: 'operation',
        value: 'make_call',
      },
      required: true,
    },
    {
      id: 'from',
      title: 'From Twilio Number',
      type: 'short-input',
      layout: 'half',
      placeholder: '+14155556789',
      condition: {
        field: 'operation',
        value: 'make_call',
      },
      required: true,
    },
    {
      id: 'url',
      title: 'TwiML URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'https://example.com/twiml',
      condition: {
        field: 'operation',
        value: 'make_call',
      },
    },
    {
      id: 'twiml',
      title: 'TwiML Instructions',
      type: 'long-input',
      layout: 'full',
      placeholder: '<Response><Say>Hello from Twilio!</Say></Response>',
      condition: {
        field: 'operation',
        value: 'make_call',
      },
    },
    {
      id: 'record',
      title: 'Record Call',
      type: 'switch',
      layout: 'half',
      condition: {
        field: 'operation',
        value: 'make_call',
      },
    },
    {
      id: 'timeout',
      title: 'Timeout (seconds)',
      type: 'short-input',
      layout: 'half',
      placeholder: '60',
      condition: {
        field: 'operation',
        value: 'make_call',
      },
    },
    {
      id: 'statusCallback',
      title: 'Status Callback URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'https://example.com/status',
      condition: {
        field: 'operation',
        value: 'make_call',
      },
    },
    {
      id: 'machineDetection',
      title: 'Machine Detection',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Disabled', id: '' },
        { label: 'Enable', id: 'Enable' },
        { label: 'Detect Message End', id: 'DetectMessageEnd' },
      ],
      condition: {
        field: 'operation',
        value: 'make_call',
      },
    },
    // Get Recording fields
    {
      id: 'recordingSid',
      title: 'Recording SID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'RExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      condition: {
        field: 'operation',
        value: 'get_recording',
      },
      required: true,
    },
  ],
  tools: {
    access: ['twilio_voice_make_call', 'twilio_voice_get_recording'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'make_call':
            return 'twilio_voice_make_call'
          case 'get_recording':
            return 'twilio_voice_get_recording'
          default:
            return 'twilio_voice_make_call'
        }
      },
      params: (params) => {
        const { operation, timeout, record, ...rest } = params

        const baseParams = { ...rest }

        // Convert timeout string to number for make_call
        if (operation === 'make_call' && timeout) {
          baseParams.timeout = Number.parseInt(timeout, 10)
        }

        // Convert record to proper boolean for make_call
        if (operation === 'make_call' && record !== undefined && record !== null) {
          // Handle various input types: boolean, string, number
          if (typeof record === 'string') {
            baseParams.record = record.toLowerCase() === 'true' || record === '1'
          } else if (typeof record === 'number') {
            baseParams.record = record !== 0
          } else {
            baseParams.record = Boolean(record)
          }
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Voice operation to perform' },
    accountSid: { type: 'string', description: 'Twilio Account SID' },
    authToken: { type: 'string', description: 'Twilio Auth Token' },
    to: { type: 'string', description: 'Destination phone number' },
    from: { type: 'string', description: 'Source Twilio number' },
    url: { type: 'string', description: 'TwiML URL' },
    twiml: { type: 'string', description: 'TwiML instructions' },
    record: { type: 'boolean', description: 'Record the call' },
    timeout: { type: 'string', description: 'Call timeout in seconds' },
    statusCallback: { type: 'string', description: 'Status callback URL' },
    machineDetection: { type: 'string', description: 'Answering machine detection' },
    recordingSid: { type: 'string', description: 'Recording SID to retrieve' },
  },
  outputs: {
    // Tool outputs (when using voice operations)
    success: { type: 'boolean', description: 'Operation success status' },
    callSid: { type: 'string', description: 'Call unique identifier' },
    status: { type: 'string', description: 'Call or recording status' },
    direction: { type: 'string', description: 'Call direction' },
    duration: { type: 'number', description: 'Call/recording duration in seconds' },
    price: { type: 'string', description: 'Cost of the operation' },
    priceUnit: { type: 'string', description: 'Currency of the price' },
    recordingSid: { type: 'string', description: 'Recording unique identifier' },
    channels: { type: 'number', description: 'Number of recording channels' },
    source: { type: 'string', description: 'Recording source' },
    mediaUrl: { type: 'string', description: 'URL to download recording' },
    uri: { type: 'string', description: 'Resource URI' },
    transcriptionText: {
      type: 'string',
      description: 'Transcribed text (only if TwiML includes <Record transcribe="true">)',
    },
    transcriptionStatus: {
      type: 'string',
      description: 'Transcription status (completed, in-progress, failed)',
    },
    error: { type: 'string', description: 'Error message if operation failed' },
    // Trigger outputs (when used as webhook trigger for incoming calls)
    accountSid: { type: 'string', description: 'Twilio Account SID from webhook' },
    from: { type: 'string', description: "Caller's phone number (E.164 format)" },
    to: { type: 'string', description: 'Recipient phone number (your Twilio number)' },
    callStatus: {
      type: 'string',
      description: 'Status of the incoming call (queued, ringing, in-progress, completed, etc.)',
    },
    apiVersion: { type: 'string', description: 'Twilio API version' },
    callerName: { type: 'string', description: 'Caller ID name if available' },
    forwardedFrom: { type: 'string', description: 'Phone number that forwarded this call' },
    digits: { type: 'string', description: 'DTMF digits entered by caller (from <Gather>)' },
    speechResult: { type: 'string', description: 'Speech recognition result (if using <Gather>)' },
    recordingUrl: { type: 'string', description: 'URL of call recording if available' },
    raw: { type: 'string', description: 'Complete raw webhook payload as JSON string' },
  },
  triggers: {
    enabled: true,
    available: ['twilio_voice_webhook'],
  },
}
