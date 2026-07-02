import { ClerkIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildClerkExtraFields,
  buildOrganizationMembershipDeletedOutputs,
  clerkSetupInstructions,
  clerkTriggerOptions,
} from '@/triggers/clerk/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Clerk Organization Membership Deleted Trigger.
 * Triggers when a member is removed from an organization.
 */
export const clerkOrganizationMembershipDeletedTrigger: TriggerConfig = {
  id: 'clerk_organization_membership_deleted',
  name: 'Clerk Organization Membership Deleted',
  provider: 'clerk',
  description: 'Trigger workflow when a Clerk organization membership is deleted',
  version: '1.0.0',
  icon: ClerkIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'clerk_organization_membership_deleted',
    triggerOptions: clerkTriggerOptions,
    setupInstructions: clerkSetupInstructions('organizationMembership.deleted'),
    extraFields: buildClerkExtraFields('clerk_organization_membership_deleted'),
  }),

  outputs: buildOrganizationMembershipDeletedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
