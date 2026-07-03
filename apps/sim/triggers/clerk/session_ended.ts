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
 * Clerk Session Ended Trigger.
 * Triggers when a user signs out and the session ends.
 */
export const clerkSessionEndedTrigger: TriggerConfig = {
  id: 'clerk_session_ended',
  name: 'Clerk Session Ended',
  provider: 'clerk',
  description: 'Trigger workflow when a Clerk session ends',
  version: '1.0.0',
  icon: ClerkIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'clerk_session_ended',
    triggerOptions: clerkTriggerOptions,
    setupInstructions: clerkSetupInstructions('session.ended'),
    extraFields: buildClerkExtraFields('clerk_session_ended'),
  }),

  outputs: buildSessionOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
