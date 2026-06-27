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
 * Clerk User Created Trigger (primary).
 * Triggers when a new user registers or is created via the Dashboard or Backend API.
 */
export const clerkUserCreatedTrigger: TriggerConfig = {
  id: 'clerk_user_created',
  name: 'Clerk User Created',
  provider: 'clerk',
  description: 'Trigger workflow when a Clerk user is created',
  version: '1.0.0',
  icon: ClerkIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'clerk_user_created',
    triggerOptions: clerkTriggerOptions,
    includeDropdown: true,
    setupInstructions: clerkSetupInstructions('user.created'),
    extraFields: buildClerkExtraFields('clerk_user_created'),
  }),

  outputs: buildUserOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
