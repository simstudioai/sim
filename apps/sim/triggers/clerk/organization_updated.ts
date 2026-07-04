import { ClerkIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildClerkExtraFields,
  buildOrganizationOutputs,
  clerkSetupInstructions,
  clerkTriggerOptions,
} from '@/triggers/clerk/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Clerk Organization Updated Trigger.
 * Triggers when an organization's details are updated.
 */
export const clerkOrganizationUpdatedTrigger: TriggerConfig = {
  id: 'clerk_organization_updated',
  name: 'Clerk Organization Updated',
  provider: 'clerk',
  description: 'Trigger workflow when a Clerk organization is updated',
  version: '1.0.0',
  icon: ClerkIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'clerk_organization_updated',
    triggerOptions: clerkTriggerOptions,
    setupInstructions: clerkSetupInstructions('organization.updated'),
    extraFields: buildClerkExtraFields('clerk_organization_updated'),
  }),

  outputs: buildOrganizationOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
