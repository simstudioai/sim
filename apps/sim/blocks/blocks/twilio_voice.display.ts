import { TwilioIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const TwilioVoiceBlockDisplay = {
  type: 'twilio_voice',
  name: 'Twilio Voice',
  description: 'Make and manage phone calls',
  category: 'tools',
  bgColor: '#F22F46',
  icon: TwilioIcon,
  iconColor: '#F22F46',
  longDescription:
    'Integrate Twilio Voice into the workflow. Make outbound calls and retrieve call recordings.',
  docsLink: 'https://docs.sim.ai/integrations/twilio_voice',
  integrationType: IntegrationType.Communication,
  triggerAllowed: true,
} satisfies BlockDisplay

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
