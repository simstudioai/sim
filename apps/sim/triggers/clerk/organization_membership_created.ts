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
 * Clerk Organization Membership Created Trigger.
 * Triggers when a user is added as a member of an organization.
 */
export const clerkOrganizationMembershipCreatedTrigger: TriggerConfig = {
  id: 'clerk_organization_membership_created',
  name: 'Clerk Organization Membership Created',
  provider: 'clerk',
  description: 'Trigger workflow when a Clerk organization membership is created',
  version: '1.0.0',
  icon: ClerkIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'clerk_organization_membership_created',
    triggerOptions: clerkTriggerOptions,
    setupInstructions: clerkSetupInstructions('organizationMembership.created'),
    extraFields: buildClerkExtraFields('clerk_organization_membership_created'),
  }),

  outputs: buildOrganizationMembershipOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
