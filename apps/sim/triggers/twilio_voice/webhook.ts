import { TwilioIcon } from '@/components/icons'
import type { TriggerConfig } from '../types'

export const twilioVoiceWebhookTrigger: TriggerConfig = {
  id: 'twilio_voice_webhook',
  name: 'Twilio Voice Webhook',
  provider: 'twilio_voice',
  description: 'Trigger workflow when phone calls are received via Twilio Voice',
  version: '1.0.0',
  icon: TwilioIcon,

  subBlocks: [
    {
      id: 'webhookUrlDisplay',
      title: 'Webhook URL',
      type: 'short-input',
      readOnly: true,
      showCopyButton: true,
      useWebhookUrl: true,
      placeholder: 'Webhook URL will be generated',
      mode: 'trigger',
    },
    {
      id: 'accountSid',
      title: 'Twilio Account SID',
      type: 'short-input',
      placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      description: 'Your Twilio Account SID from the Twilio Console',
      required: true,
      mode: 'trigger',
    },
    {
      id: 'authToken',
      title: 'Auth Token',
      type: 'short-input',
      placeholder: 'Your Twilio Auth Token',
      description: 'Your Twilio Auth Token for webhook signature verification',
      password: true,
      required: true,
      mode: 'trigger',
    },
    {
      id: 'twimlResponse',
      title: 'TwiML Response',
      type: 'long-input',
      placeholder: '[Response][Say]Please hold.[/Say][/Response]',
      description:
        'TwiML instructions to return immediately to Twilio. Use square brackets instead of angle brackets (e.g., [Response] instead of <Response>). This controls what happens when the call comes in (e.g., play a message, record, gather input). Your workflow will execute in the background.',
      required: false,
      mode: 'trigger',
      wandConfig: {
        enabled: true,
        prompt: `Generate TwiML (Twilio Markup Language) for voice calls based on the user's description.

### IMPORTANT: Use SQUARE BRACKETS instead of angle brackets
- Use [Tag] instead of <Tag>
- Use [/Tag] instead of </Tag>
- Use [Tag/] for self-closing tags instead of <Tag/>

### COMMON TWIML VERBS

**[Say]** - Text-to-speech
[Say voice="alice"]Hello, how can I help you?[/Say]
- Voices: alice, man, woman, Polly.Joanna, Polly.Matthew, etc.

**[Play]** - Play audio file
[Play]https://example.com/audio.mp3[/Play]

**[Record]** - Record caller's voice
[Record maxLength="120" transcribe="true"/]
- transcribe="true" to get text transcription

**[Gather]** - Collect keypad input or speech
[Gather input="dtmf speech" timeout="5" numDigits="1"]
  [Say]Press 1 for sales, 2 for support.[/Say]
[/Gather]

**[Dial]** - Connect to another number
[Dial]+14155551234[/Dial]

**[Pause]** - Add silence
[Pause length="2"/]

**[Hangup]** - End the call
[Hangup/]

**[Redirect]** - Redirect to another URL
[Redirect]https://example.com/next[/Redirect]

### EXAMPLES

"say hello and ask them to leave a message"
-> [Response][Say voice="alice"]Hello! Please leave a message after the beep.[/Say][Record maxLength="120" transcribe="true"/][/Response]

"greet and offer options: press 1 for sales, 2 for support"
-> [Response][Gather input="dtmf" timeout="5" numDigits="1"][Say voice="alice"]Welcome! Press 1 for sales, or press 2 for support.[/Say][/Gather][Say]Sorry, I didn't get that. Goodbye.[/Say][/Response]

"play hold music"
-> [Response][Say voice="alice"]Please hold while we connect you.[/Say][Play loop="0"]https://api.twilio.com/cowbell.mp3[/Play][/Response]

"just say please wait"
-> [Response][Say voice="alice"]Please wait while we process your request.[/Say][/Response]

"record a voicemail with transcription"
-> [Response][Say voice="alice"]You've reached our voicemail. Please leave a message.[/Say][Record transcribe="true" maxLength="180" playBeep="true"/][Say voice="alice"]Thank you for your message. Goodbye.[/Say][/Response]

Return ONLY the TwiML with square brackets - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe what should happen when a call comes in...',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'twilio_voice_webhook',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Enter a TwiML Response above - this tells Twilio what to do when a call comes in (e.g., play a message, record, gather input). Note: Use square brackets [Tag] instead of angle brackets for TwiML tags.',
        'Example TwiML for recording with transcription: <code>[Response][Say]Please leave a message.[/Say][Record transcribe="true" maxLength="120"/][/Response]</code>',
        'Go to your <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" target="_blank" rel="noopener noreferrer">Twilio Console Phone Numbers page</a>.',
        'Select the phone number you want to use for incoming calls.',
        'Scroll down to the "Voice Configuration" section.',
        'In the "A CALL COMES IN" field, select "Webhook" and paste the Webhook URL (from above).',
        'Ensure the HTTP method is set to POST.',
        'How it works: When a call comes in, Twilio receives your TwiML response immediately and executes those instructions. Your workflow runs in the background with access to caller information, call status, and any recorded/transcribed data.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    },
  ],

  outputs: {
    callSid: {
      type: 'string',
      description: 'Unique identifier for this call',
    },
    accountSid: {
      type: 'string',
      description: 'Twilio Account SID',
    },
    from: {
      type: 'string',
      description: "Caller's phone number (E.164 format)",
    },
    to: {
      type: 'string',
      description: 'Recipient phone number (your Twilio number)',
    },
    callStatus: {
      type: 'string',
      description: 'Status of the call (queued, ringing, in-progress, completed, etc.)',
    },
    direction: {
      type: 'string',
      description: 'Call direction: inbound or outbound',
    },
    apiVersion: {
      type: 'string',
      description: 'Twilio API version',
    },
    callerName: {
      type: 'string',
      description: 'Caller ID name if available',
    },
    forwardedFrom: {
      type: 'string',
      description: 'Phone number that forwarded this call',
    },
    digits: {
      type: 'string',
      description: 'DTMF digits entered by caller (from <Gather>)',
    },
    speechResult: {
      type: 'string',
      description: 'Speech recognition result (if using <Gather> with speech)',
    },
    recordingUrl: {
      type: 'string',
      description: 'URL of call recording if available',
    },
    recordingSid: {
      type: 'string',
      description: 'Recording SID if available',
    },
    called: {
      type: 'string',
      description: 'Phone number that was called (same as "to")',
    },
    caller: {
      type: 'string',
      description: 'Phone number of the caller (same as "from")',
    },
    toCity: {
      type: 'string',
      description: 'City of the called number',
    },
    toState: {
      type: 'string',
      description: 'State/province of the called number',
    },
    toZip: {
      type: 'string',
      description: 'Zip/postal code of the called number',
    },
    toCountry: {
      type: 'string',
      description: 'Country of the called number',
    },
    fromCity: {
      type: 'string',
      description: 'City of the caller',
    },
    fromState: {
      type: 'string',
      description: 'State/province of the caller',
    },
    fromZip: {
      type: 'string',
      description: 'Zip/postal code of the caller',
    },
    fromCountry: {
      type: 'string',
      description: 'Country of the caller',
    },
    calledCity: {
      type: 'string',
      description: 'City of the called number (same as toCity)',
    },
    calledState: {
      type: 'string',
      description: 'State of the called number (same as toState)',
    },
    calledZip: {
      type: 'string',
      description: 'Zip code of the called number (same as toZip)',
    },
    calledCountry: {
      type: 'string',
      description: 'Country of the called number (same as toCountry)',
    },
    callerCity: {
      type: 'string',
      description: 'City of the caller (same as fromCity)',
    },
    callerState: {
      type: 'string',
      description: 'State of the caller (same as fromState)',
    },
    callerZip: {
      type: 'string',
      description: 'Zip code of the caller (same as fromZip)',
    },
    callerCountry: {
      type: 'string',
      description: 'Country of the caller (same as fromCountry)',
    },
    callToken: {
      type: 'string',
      description: 'Twilio call token for authentication',
    },
    raw: {
      type: 'string',
      description: 'Complete raw webhook payload from Twilio as JSON string',
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  },
}
