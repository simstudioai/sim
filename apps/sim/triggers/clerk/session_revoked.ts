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
 * Clerk Session Revoked Trigger.
 * Triggers when a session is revoked, e.g. via the Revoke Session API or Dashboard.
 */
export const clerkSessionRevokedTrigger: TriggerConfig = {
  id: 'clerk_session_revoked',
  name: 'Clerk Session Revoked',
  provider: 'clerk',
  description: 'Trigger workflow when a Clerk session is revoked',
  version: '1.0.0',
  icon: ClerkIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'clerk_session_revoked',
    triggerOptions: clerkTriggerOptions,
    setupInstructions: clerkSetupInstructions('session.revoked'),
    extraFields: buildClerkExtraFields('clerk_session_revoked'),
  }),

  outputs: buildSessionOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
