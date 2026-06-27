import { ClerkIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildClerkExtraFields,
  buildSessionOutputs,
  clerkSetupInstructions,
  clerkTriggerOptions,
} from '@/triggers/clerk/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Clerk Session Created Trigger.
 * Triggers when a user signs in and a new session is created.
 */
export const clerkSessionCreatedTrigger: TriggerConfig = {
  id: 'clerk_session_created',
  name: 'Clerk Session Created',
  provider: 'clerk',
  description: 'Trigger workflow when a Clerk session is created',
  version: '1.0.0',
  icon: ClerkIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'clerk_session_created',
    triggerOptions: clerkTriggerOptions,
    setupInstructions: clerkSetupInstructions('session.created'),
    extraFields: buildClerkExtraFields('clerk_session_created'),
  }),

  outputs: buildSessionOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
