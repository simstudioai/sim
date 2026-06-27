import { TwilioIcon } from '@/components/icons'
import { TwilioVoiceBlockDisplay } from '@/blocks/blocks/twilio_voice.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'
import { getTrigger } from '@/triggers'

export const TwilioVoiceBlock: BlockConfig<ToolResponse> = {
  ...TwilioVoiceBlockDisplay,
  authMode: AuthMode.ApiKey, // Twilio brand color
  subBlocks: [
    ...getTrigger('twilio_voice_webhook').subBlocks,
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Make Call', id: 'make_call' },
        { label: 'List Calls', id: 'list_calls' },
        { label: 'Get Recording', id: 'get_recording' },
      ],
      value: () => 'make_call',
    },
    {
      id: 'accountSid',
      title: 'Twilio Account SID',
      type: 'short-input',
      placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      required: true,
    },
    {
      id: 'authToken',
      title: 'Auth Token',
      type: 'short-input',
      placeholder: 'Your Twilio Auth Token',
      password: true,
      required: true,
    },
    {
      id: 'to',
      title: 'To Phone Number',
      type: 'short-input',
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
      placeholder: '[Response][Say]Hello from Twilio![/Say][/Response]',
      description:
        'Use square brackets instead of angle brackets (e.g., [Response] instead of <Response>)',
      condition: {
        field: 'operation',
        value: 'make_call',
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate TwiML (Twilio Markup Language) for outbound voice calls based on the user's description.

### IMPORTANT: Use SQUARE BRACKETS instead of angle brackets
- Use [Tag] instead of <Tag>
- Use [/Tag] instead of </Tag>
- Use [Tag/] for self-closing tags instead of <Tag/>

### COMMON TWIML VERBS

**[Say]** - Text-to-speech
[Say voice="alice"]Hello, this is an automated call.[/Say]
- Voices: alice, man, woman, Polly.Joanna, Polly.Matthew, etc.

**[Play]** - Play audio file
[Play]https://example.com/audio.mp3[/Play]

**[Record]** - Record caller's voice
[Record maxLength="120" transcribe="true"/]
- transcribe="true" to get text transcription

**[Gather]** - Collect keypad input or speech
[Gather input="dtmf speech" timeout="5" numDigits="1"]
  [Say]Press 1 to confirm, 2 to cancel.[/Say]
[/Gather]

**[Dial]** - Connect to another number
[Dial]+14155551234[/Dial]

**[Pause]** - Add silence
[Pause length="2"/]

**[Hangup]** - End the call
[Hangup/]

### EXAMPLES

"say hello and deliver a reminder message"
-> [Response][Say voice="alice"]Hello! This is a reminder about your appointment tomorrow at 2 PM. Press 1 to confirm or 2 to reschedule.[/Say][Gather input="dtmf" timeout="10" numDigits="1"/][/Response]

"play a recorded message"
-> [Response][Play]https://example.com/message.mp3[/Play][/Response]

"say a message and record their response"
-> [Response][Say voice="alice"]Hello! Please leave your feedback after the beep.[/Say][Record maxLength="60" transcribe="true"/][Say voice="alice"]Thank you for your feedback. Goodbye.[/Say][/Response]

"simple greeting message"
-> [Response][Say voice="alice"]Hello! This is an automated call from your service provider. Have a great day![/Say][/Response]

"ask a yes or no question"
-> [Response][Say voice="alice"]Hello! Would you like to receive updates? Press 1 for yes, or 2 for no.[/Say][Gather input="dtmf" timeout="10" numDigits="1"/][Say voice="alice"]We didn't receive your response. Goodbye.[/Say][/Response]

Return ONLY the TwiML with square brackets - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe what the call should say or do...',
      },
    },
    {
      id: 'record',
      title: 'Record Call',
      type: 'switch',
      condition: {
        field: 'operation',
        value: 'make_call',
      },
    },
    {
      id: 'timeout',
      title: 'Timeout (seconds)',
      type: 'short-input',
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
    {
      id: 'listTo',
      title: 'To Number',
      type: 'short-input',
      placeholder: '+14155551234',
      condition: {
        field: 'operation',
        value: 'list_calls',
      },
    },
    {
      id: 'listFrom',
      title: 'From Number',
      type: 'short-input',
      placeholder: '+14155556789',
      condition: {
        field: 'operation',
        value: 'list_calls',
      },
    },
    {
      id: 'listStatus',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Queued', id: 'queued' },
        { label: 'Ringing', id: 'ringing' },
        { label: 'In Progress', id: 'in-progress' },
        { label: 'Completed', id: 'completed' },
        { label: 'Failed', id: 'failed' },
        { label: 'Busy', id: 'busy' },
        { label: 'No Answer', id: 'no-answer' },
        { label: 'Canceled', id: 'canceled' },
      ],
      condition: {
        field: 'operation',
        value: 'list_calls',
      },
    },
    {
      id: 'listPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '50',
      condition: {
        field: 'operation',
        value: 'list_calls',
      },
    },
    {
      id: 'startTimeAfter',
      title: 'After (YYYY-MM-DD)',
      type: 'short-input',
      placeholder: '2025-01-01',
      condition: {
        field: 'operation',
        value: 'list_calls',
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date based on the user's description.
The date should be in YYYY-MM-DD format.
Examples:
- "yesterday" -> Calculate yesterday's date
- "last week" -> Calculate 7 days ago
- "beginning of this month" -> First day of the current month (YYYY-MM-01)
- "last Monday" -> Calculate the most recent Monday
- "30 days ago" -> Calculate 30 days before today

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start date (e.g., "last week", "beginning of month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'startTimeBefore',
      title: 'Before (YYYY-MM-DD)',
      type: 'short-input',
      placeholder: '2025-12-31',
      condition: {
        field: 'operation',
        value: 'list_calls',
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date based on the user's description.
The date should be in YYYY-MM-DD format.
Examples:
- "today" -> Today's date
- "end of this month" -> Last day of the current month
- "next Friday" -> Calculate the upcoming Friday
- "in 7 days" -> Calculate 7 days from today
- "end of year" -> December 31st of the current year

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end date (e.g., "today", "end of month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'recordingSid',
      title: 'Recording SID',
      type: 'short-input',
      placeholder: 'RExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      condition: {
        field: 'operation',
        value: 'get_recording',
      },
      required: true,
    },
  ],
  tools: {
    access: ['twilio_voice_make_call', 'twilio_voice_list_calls', 'twilio_voice_get_recording'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'make_call':
            return 'twilio_voice_make_call'
          case 'list_calls':
            return 'twilio_voice_list_calls'
          case 'get_recording':
            return 'twilio_voice_get_recording'
          default:
            return 'twilio_voice_make_call'
        }
      },
      params: (params) => {
        const { operation, timeout, record, listTo, listFrom, listStatus, listPageSize, ...rest } =
          params

        const baseParams = { ...rest }

        if (operation === 'make_call' && timeout) {
          baseParams.timeout = Number.parseInt(timeout, 10)
        }

        if (operation === 'make_call' && record !== undefined && record !== null) {
          if (typeof record === 'string') {
            baseParams.record = record.toLowerCase() === 'true' || record === '1'
          } else if (typeof record === 'number') {
            baseParams.record = record !== 0
          } else {
            baseParams.record = Boolean(record)
          }
        }

        if (operation === 'list_calls') {
          if (listTo) baseParams.to = listTo
          if (listFrom) baseParams.from = listFrom
          if (listStatus) baseParams.status = listStatus
          if (listPageSize) baseParams.pageSize = Number.parseInt(listPageSize, 10)
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
    listTo: { type: 'string', description: 'Filter calls by To number' },
    listFrom: { type: 'string', description: 'Filter calls by From number' },
    listStatus: { type: 'string', description: 'Filter calls by status' },
    listPageSize: { type: 'string', description: 'Number of calls to return per page' },
    startTimeAfter: { type: 'string', description: 'Filter calls that started after this date' },
    startTimeBefore: { type: 'string', description: 'Filter calls that started before this date' },
    recordingSid: { type: 'string', description: 'Recording SID to retrieve' },
  },
  outputs: {
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
    calls: { type: 'array', description: 'Array of call objects (for list_calls operation)' },
    total: { type: 'number', description: 'Total number of calls returned' },
    page: { type: 'number', description: 'Current page number' },
    pageSize: { type: 'number', description: 'Number of calls per page' },
    error: { type: 'string', description: 'Error message if operation failed' },
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

export const TwilioVoiceBlockMeta = {
  tags: ['messaging', 'text-to-speech'],
  url: 'https://www.twilio.com',
  templates: [
    {
      icon: TwilioIcon,
      title: 'Twilio Voice IVR router',
      prompt:
        'Create a workflow that handles inbound Twilio Voice calls with an IVR menu, captures caller intent, routes to the right queue, and writes the call summary to a support table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation'],
    },
    {
      icon: TwilioIcon,
      title: 'Twilio Voice outbound dialer',
      prompt:
        'Build a workflow that reads a callbacks table, places Twilio Voice calls in batches, plays a recorded message or connects to an agent, and logs the call outcome back to the row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
    },
    {
      icon: TwilioIcon,
      title: 'Twilio Voice incident dialer',
      prompt:
        'Create a workflow that on a PagerDuty severity-1 incident places a Twilio Voice call to the on-call engineer with an automated message, escalates to backup if no answer, and logs the cascade.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: TwilioIcon,
      title: 'Twilio Voice transcript-to-CRM',
      prompt:
        'Build a workflow that runs after a Twilio Voice call ends, transcribes the recording, summarizes the conversation, and writes the summary plus action items to the linked Salesforce account.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: TwilioIcon,
      title: 'Twilio Voice survey collector',
      prompt:
        'Create a workflow that places Twilio Voice survey calls to recent customers, captures their NPS rating via key press, and writes results to a feedback table for analysis.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'analysis'],
    },
    {
      icon: TwilioIcon,
      title: 'Twilio Voice spam-call filter',
      prompt:
        'Build a workflow that screens inbound Twilio Voice calls, classifies likely spam using number reputation plus a spoken challenge captured via Gather DTMF — press a digit to continue — and routes only verified callers to the support queue.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation'],
    },
    {
      icon: TwilioIcon,
      title: 'Twilio Voice call QA reviewer',
      prompt:
        "Create a scheduled workflow that lists yesterday's Twilio Voice calls, pulls each recording, transcribes and scores it for tone, compliance phrases, and resolution, and writes a QA scorecard to a table while flagging low-scoring calls to the team lead in Slack.",
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'analysis', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'place-outbound-call',
      description:
        'Place an outbound Twilio Voice call that speaks a message or plays audio via TwiML.',
      content:
        '# Place an Outbound Voice Call\n\nDial a number and play a spoken message or audio using TwiML.\n\n## Steps\n1. Use the Make Call operation with your Account SID and Auth Token.\n2. Set the To Phone Number and the From Twilio Number, both in E.164 format.\n3. Provide TwiML Instructions describing what the call should say or do (use square brackets like [Say]Hello[/Say]), or point a TwiML URL at hosted instructions.\n4. Enable Record Call and set a Timeout if you need the recording or a ring limit, and add Machine Detection to handle voicemail.\n\n## Output\nReturn the call SID and status so the call can be tracked or its recording retrieved later.',
    },
    {
      name: 'collect-keypad-response',
      description:
        'Place a call that asks a question and captures the caller keypad or speech response.',
      content:
        '# Collect a Keypad or Speech Response\n\nCall a recipient, ask a question, and capture their response for branching logic.\n\n## Steps\n1. Use the Make Call operation with the To and From numbers and your credentials.\n2. In the TwiML Instructions, use [Gather] to collect input, for example [Gather input="dtmf" numDigits="1"][Say]Press 1 to confirm, 2 to cancel[/Say][/Gather].\n3. For surveys, gather a rating digit; for confirmations, gather a single yes or no digit.\n4. Enable Record Call when you also want the audio.\n\n## Output\nReturn the captured digits or speech result from the webhook so a later step can branch on the caller response.',
    },
    {
      name: 'retrieve-call-recording',
      description: 'Fetch a Twilio Voice call recording and its transcription by recording SID.',
      content:
        '# Retrieve a Call Recording\n\nPull the recording and transcript of a completed call for QA or CRM logging.\n\n## Steps\n1. Use the Get Recording operation with your Account SID and Auth Token.\n2. Provide the Recording SID (it begins with RE) from the call you want.\n3. If the original call TwiML used [Record transcribe="true"], the transcription text is returned alongside the audio.\n\n## Output\nReturn the media URL to download the recording, its duration, and the transcription text and status so the call can be summarized or archived.',
    },
    {
      name: 'review-recent-calls',
      description: 'List recent Twilio Voice calls filtered by number, status, and date range.',
      content:
        '# Review Recent Voice Calls\n\nPull a filtered list of calls to build a report or feed a follow-up workflow.\n\n## Steps\n1. Use the List Calls operation with your Account SID and Auth Token.\n2. Filter by To Number, From Number, or Status (for example completed or no-answer).\n3. Narrow the window with After and Before dates (natural language like "last week" works), and set a Page Size.\n\n## Output\nReturn the array of matching calls with their SIDs, status, direction, and duration, plus the total count for reporting.',
    },
  ],
} as const satisfies BlockMeta
