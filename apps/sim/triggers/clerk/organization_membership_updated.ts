import { ClerkIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildClerkExtraFields,
  buildOrganizationMembershipOutputs,
  clerkSetupInstructions,
  clerkTriggerOptions,
} from '@/triggers/clerk/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Clerk Organization Membership Updated Trigger.
 * Triggers when a member's role within an organization changes.
 */
export const clerkOrganizationMembershipUpdatedTrigger: TriggerConfig = {
  id: 'clerk_organization_membership_updated',
  name: 'Clerk Organization Membership Updated',
  provider: 'clerk',
  description: 'Trigger workflow when a Clerk organization membership is updated',
  version: '1.0.0',
  icon: ClerkIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'clerk_organization_membership_updated',
    triggerOptions: clerkTriggerOptions,
    setupInstructions: clerkSetupInstructions('organizationMembership.updated'),
    extraFields: buildClerkExtraFields('clerk_organization_membership_updated'),
  }),

  outputs: buildOrganizationMembershipOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
