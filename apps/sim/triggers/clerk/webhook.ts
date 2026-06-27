import { ClerkIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildClerkExtraFields,
  buildClerkOutputs,
  clerkSetupInstructions,
  clerkTriggerOptions,
} from '@/triggers/clerk/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Clerk Generic Webhook Trigger (all events).
 * Triggers for any Clerk webhook event you subscribe the endpoint to.
 */
export const clerkWebhookTrigger: TriggerConfig = {
  id: 'clerk_webhook',
  name: 'Clerk Webhook',
  provider: 'clerk',
  description: 'Trigger workflow on any Clerk webhook event',
  version: '1.0.0',
  icon: ClerkIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'clerk_webhook',
    triggerOptions: clerkTriggerOptions,
    setupInstructions: clerkSetupInstructions('events you want to receive'),
    extraFields: buildClerkExtraFields('clerk_webhook'),
  }),

  outputs: buildClerkOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
