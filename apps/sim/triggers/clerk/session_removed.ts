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
 * Clerk Session Removed Trigger.
 * Triggers when a session is removed, e.g. because the associated user was deleted.
 */
export const clerkSessionRemovedTrigger: TriggerConfig = {
  id: 'clerk_session_removed',
  name: 'Clerk Session Removed',
  provider: 'clerk',
  description: 'Trigger workflow when a Clerk session is removed',
  version: '1.0.0',
  icon: ClerkIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'clerk_session_removed',
    triggerOptions: clerkTriggerOptions,
    setupInstructions: clerkSetupInstructions('session.removed'),
    extraFields: buildClerkExtraFields('clerk_session_removed'),
  }),

  outputs: buildSessionOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
