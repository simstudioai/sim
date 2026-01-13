import { LemlistIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildAllOutputs,
  lemlistSetupInstructions,
  lemlistTriggerOptions,
} from '@/triggers/lemlist/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Generic Lemlist Webhook Trigger
 * Captures all Lemlist webhook events with optional filtering
 */
export const lemlistWebhookTrigger: TriggerConfig = {
  id: 'lemlist_webhook',
  name: 'Lemlist Webhook (All Events)',
  provider: 'lemlist',
  description: 'Trigger workflow on any Lemlist webhook event',
  version: '1.0.0',
  icon: LemlistIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'lemlist_webhook',
    triggerOptions: lemlistTriggerOptions,
    setupInstructions: lemlistSetupInstructions('All Events (omit type field)'),
    extraFields: [
      {
        id: 'eventTypes',
        title: 'Event Types to Listen For',
        type: 'dropdown',
        multiSelect: true,
        options: [
          // Email Events
          { label: 'Email Sent', id: 'emailsSent' },
          { label: 'Email Opened', id: 'emailsOpened' },
          { label: 'Email Clicked', id: 'emailsClicked' },
          { label: 'Email Replied', id: 'emailsReplied' },
          { label: 'Email Bounced', id: 'emailsBounced' },
          { label: 'Email Unsubscribed', id: 'emailsUnsubscribed' },
          // LinkedIn Events
          { label: 'LinkedIn Replied', id: 'linkedinReplied' },
          { label: 'LinkedIn Invite Accepted', id: 'linkedinInviteAccepted' },
          { label: 'LinkedIn Sent', id: 'linkedinSent' },
          // Lead Status Events
          { label: 'Interested', id: 'interested' },
          { label: 'Not Interested', id: 'notInterested' },
          { label: 'Contacted', id: 'contacted' },
          { label: 'Paused', id: 'paused' },
          // System Events
          { label: 'Campaign Complete', id: 'campaignComplete' },
        ],
        placeholder: 'Leave empty to receive all events',
        description:
          'Select specific events to filter. Leave empty to receive all events from Lemlist.',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'lemlist_webhook' },
      },
      {
        id: 'campaignId',
        title: 'Campaign ID (Optional)',
        type: 'short-input',
        placeholder: 'cam_xxxxx (leave empty for all campaigns)',
        description: 'Optionally scope the webhook to a specific campaign',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'lemlist_webhook' },
      },
    ],
  }),

  outputs: buildAllOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
