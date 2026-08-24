import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

export const photonImessageTriggerOptions = [
  { label: 'Message Received', id: 'photon_imessage_message_received' },
  { label: 'Tapback Received', id: 'photon_imessage_reaction_received' },
  { label: 'Read Receipt', id: 'photon_imessage_read_receipt' },
  { label: 'Any Event', id: 'photon_imessage_webhook' },
]

/**
 * Which slim content arms each trigger fires on. `null` means every delivery. Kept in sync with
 * `matchEvent` in `apps/sim/lib/webhooks/providers/photon-imessage.ts`.
 *
 * Photon delivers every record on one webhook; the content `type` is the event discriminator.
 * Signals (`typing`) never fire workflows, and neither do our own outbound sends — see
 * `shouldSkipEvent`, which drops them before routing so a reply cannot re-trigger its own workflow.
 */
export const PHOTON_TRIGGER_CONTENT_TYPES: Record<string, readonly string[] | null> = {
  photon_imessage_message_received: null, // any content that is not claimed below and not a signal
  photon_imessage_reaction_received: ['reaction'],
  photon_imessage_read_receipt: ['read'],
  photon_imessage_webhook: null,
}

/** Content arms that are reactions/receipts rather than user-authored messages. */
export const PHOTON_NON_MESSAGE_CONTENT_TYPES = ['reaction', 'read'] as const

/** Signals that never fire any trigger. */
export const PHOTON_SKIPPED_CONTENT_TYPES = ['typing'] as const

/**
 * Project credentials power automatic webhook registration: on deploy, Sim registers this
 * workflow's webhook URL with the Photon API and stores the returned signing secret; removing the
 * trigger deletes the registration. The signing secret itself is system-managed and never entered
 * by hand.
 */
export function buildPhotonImessageCredFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'triggerProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Photon project ID',
      description: 'Project ID from app.photon.codes, used to register the webhook.',
      paramVisibility: 'user-only',
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'triggerProjectSecret',
      title: 'Project Secret',
      type: 'short-input',
      placeholder: 'Photon project secret',
      description:
        'Project secret from app.photon.codes. Also used to clean up the webhook when the trigger is removed.',
      password: true,
      paramVisibility: 'user-only',
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'triggerSenderAllowlist',
      title: 'Sender Allowlist (Optional)',
      type: 'short-input',
      placeholder: 'Leave empty for all senders (e.g. +15551234567, name@icloud.com)',
      description:
        'Comma-separated phone numbers or Apple ID emails. When set, only deliveries from these senders fire the workflow.',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

export function photonImessageSetupInstructions(eventLabel: string): string {
  const instructions = [
    'Enter your Photon <strong>Project ID</strong> and <strong>Project Secret</strong> from the <a href="https://app.photon.codes" target="_blank" rel="noopener noreferrer">Photon dashboard</a>.',
    `Click <strong>Save Configuration</strong> to automatically register this webhook with Photon for <strong>${eventLabel}</strong>. The signing secret is stored for you, and the registration is deleted automatically when you remove this trigger.`,
    'Text the Photon number to see the workflow run.',
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
      description: 'Content arm of the message, such as text, attachment, voice, reply, or group',
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
        'Attachment metadata as { id, name, mimeType, size } objects. Use the Download Attachment operation to fetch bytes.',
    },
    raw: {
      type: 'string',
      description: 'Complete raw webhook payload from Photon as a JSON string',
    },
  }
}

/** Outputs for the tapback trigger. The reader of the tapback rides on the envelope sender. */
export function buildPhotonImessageReactionOutputs(): Record<string, TriggerOutput> {
  return {
    messageId: {
      type: 'string',
      description: 'Unique identifier of the reaction event (use to deduplicate)',
    },
    emoji: {
      type: 'string',
      description: 'The tapback emoji, such as a heart or thumbs up',
    },
    targetMessageId: {
      type: 'string',
      description: 'ID of the message that was reacted to',
    },
    targetPreview: {
      type: 'string',
      description: 'Text preview of the message that was reacted to',
    },
    senderId: {
      type: 'string',
      description: 'Phone number or Apple ID email of the person who reacted',
    },
    chatId: {
      type: 'string',
      description: 'Chat GUID the reaction happened in',
    },
    chatType: {
      type: 'string',
      description: 'Conversation type, dm or group',
    },
    timestamp: {
      type: 'string',
      description: 'ISO 8601 time of the reaction',
    },
    raw: {
      type: 'string',
      description: 'Complete raw webhook payload from Photon as a JSON string',
    },
  }
}

/** Outputs for the read-receipt trigger. The reader rides on the envelope sender. */
export function buildPhotonImessageReadReceiptOutputs(): Record<string, TriggerOutput> {
  return {
    messageId: {
      type: 'string',
      description: 'Unique identifier of the read-receipt event (use to deduplicate)',
    },
    targetMessageId: {
      type: 'string',
      description: 'ID of the sent message that was read',
    },
    readerId: {
      type: 'string',
      description: 'Phone number or Apple ID email of the person who read the message',
    },
    chatId: {
      type: 'string',
      description: 'Chat GUID the read receipt came from',
    },
    timestamp: {
      type: 'string',
      description: 'ISO 8601 time the message was read',
    },
    raw: {
      type: 'string',
      description: 'Complete raw webhook payload from Photon as a JSON string',
    },
  }
}

/**
 * Outputs for the catch-all trigger: the typed envelope plus the flattened common fields.
 * Per-arm details stay in `raw` rather than fabricating fields for every content type.
 */
export function buildPhotonImessageWebhookOutputs(): Record<string, TriggerOutput> {
  return {
    messageId: {
      type: 'string',
      description: 'Unique identifier of the delivered record (use to deduplicate)',
    },
    contentType: {
      type: 'string',
      description: 'Content arm of the delivery: text, attachment, reaction, read, and so on',
    },
    text: {
      type: 'string',
      description: 'Message text when the delivery carries any',
    },
    senderId: {
      type: 'string',
      description: 'Phone number or Apple ID email of the actor',
    },
    chatId: {
      type: 'string',
      description: 'Chat GUID the event happened in',
    },
    chatType: {
      type: 'string',
      description: 'Conversation type, dm or group',
    },
    timestamp: {
      type: 'string',
      description: 'ISO 8601 event time',
    },
    raw: {
      type: 'string',
      description: 'Complete raw webhook payload from Photon as a JSON string',
    },
  }
}
