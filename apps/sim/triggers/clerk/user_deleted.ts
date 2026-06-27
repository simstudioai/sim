import { ClerkIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildClerkExtraFields,
  buildUserDeletedOutputs,
  clerkSetupInstructions,
  clerkTriggerOptions,
} from '@/triggers/clerk/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Clerk User Deleted Trigger.
 * Triggers when a user deletes their account or is deleted.
 */
export const clerkUserDeletedTrigger: TriggerConfig = {
  id: 'clerk_user_deleted',
  name: 'Clerk User Deleted',
  provider: 'clerk',
  description: 'Trigger workflow when a Clerk user is deleted',
  version: '1.0.0',
  icon: ClerkIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'clerk_user_deleted',
    triggerOptions: clerkTriggerOptions,
    setupInstructions: clerkSetupInstructions('user.deleted'),
    extraFields: buildClerkExtraFields('clerk_user_deleted'),
  }),

  outputs: buildUserDeletedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
