import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

export const photonImessageTriggerOptions = [
  { label: 'Message Received', id: 'photon_imessage_message_received' },
]

/**
 * The signing secret Photon shows once when the webhook is created. It is a different credential
 * from the project secret the send tool uses: the project secret authorizes API access, this one
 * authenticates inbound deliveries.
 */
export function buildPhotonImessageAuthFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'webhookSecret',
      title: 'Webhook Signing Secret',
      type: 'short-input',
      placeholder: 'whsec_...',
      description:
        'Signing secret from the Photon webhook, used to verify the X-Spectrum-Signature header on every delivery.',
      password: true,
      paramVisibility: 'user-only',
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

export function photonImessageSetupInstructions(): string {
  const instructions = [
    'Copy the <strong>Webhook URL</strong> above.',
    'Open the <a href="https://app.photon.codes" target="_blank" rel="noopener noreferrer">Photon dashboard</a> and go to <strong>Webhooks</strong>.',
    'Create a webhook pointing at the copied URL. It must be public HTTPS.',
    'Copy the <strong>signing secret</strong> shown when the webhook is created — it is only displayed once — and paste it above.',
    'Click "Save" above to activate your trigger.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Shape of the native Photon webhook envelope (`@spectrum-ts/core/webhook`). Keys MUST stay
 * aligned with the `formatInput` implementation in
 * `apps/sim/lib/webhooks/providers/photon-imessage.ts`.
 */
export function buildPhotonImessageOutputs(): Record<string, TriggerOutput> {
  return {
    messageId: {
      type: 'string',
      description: 'Unique message identifier (use to deduplicate)',
    },
    text: {
      type: 'string',
      description: 'Message text. Empty for messages whose content is not text.',
    },
    contentType: {
      type: 'string',
      description:
        'Content arm of the message, such as text, attachment, voice, reaction, reply, or group',
    },
    senderId: {
      type: 'string',
      description: 'Phone number or Apple ID email of the sender',
    },
    chatId: {
      type: 'string',
      description: 'Chat GUID. Pass this to the send tool to reply into the same conversation.',
    },
    chatType: {
      type: 'string',
      description: 'Conversation type, dm or group',
    },
    platform: {
      type: 'string',
      description: 'Photon platform that delivered the message, such as imessage',
    },
    timestamp: {
      type: 'string',
      description: 'ISO 8601 time the message was sent',
    },
    attachments: {
      type: 'json',
      description:
        'Attachment metadata as { id, name, mimeType, size } objects. Bytes are not delivered by webhook.',
    },
    raw: {
      type: 'string',
      description: 'Complete raw webhook payload from Photon as a JSON string',
    },
  }
}
