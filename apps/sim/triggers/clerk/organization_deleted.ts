import { ClerkIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildClerkExtraFields,
  buildOrganizationDeletedOutputs,
  clerkSetupInstructions,
  clerkTriggerOptions,
} from '@/triggers/clerk/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Clerk Organization Deleted Trigger.
 * Triggers when an organization is deleted.
 */
export const clerkOrganizationDeletedTrigger: TriggerConfig = {
  id: 'clerk_organization_deleted',
  name: 'Clerk Organization Deleted',
  provider: 'clerk',
  description: 'Trigger workflow when a Clerk organization is deleted',
  version: '1.0.0',
  icon: ClerkIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'clerk_organization_deleted',
    triggerOptions: clerkTriggerOptions,
    setupInstructions: clerkSetupInstructions('organization.deleted'),
    extraFields: buildClerkExtraFields('clerk_organization_deleted'),
  }),

  outputs: buildOrganizationDeletedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
