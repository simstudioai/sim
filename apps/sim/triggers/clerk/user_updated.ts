import { ClerkIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildClerkExtraFields,
  buildUserOutputs,
  clerkSetupInstructions,
  clerkTriggerOptions,
} from '@/triggers/clerk/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Clerk User Updated Trigger.
 * Triggers when a user's information is updated.
 */
export const clerkUserUpdatedTrigger: TriggerConfig = {
  id: 'clerk_user_updated',
  name: 'Clerk User Updated',
  provider: 'clerk',
  description: 'Trigger workflow when a Clerk user is updated',
  version: '1.0.0',
  icon: ClerkIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'clerk_user_updated',
    triggerOptions: clerkTriggerOptions,
    setupInstructions: clerkSetupInstructions('user.updated'),
    extraFields: buildClerkExtraFields('clerk_user_updated'),
  }),

  outputs: buildUserOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
