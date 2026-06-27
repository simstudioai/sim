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
 * Clerk Organization Created Trigger.
 * Triggers when a new organization is created.
 */
export const clerkOrganizationCreatedTrigger: TriggerConfig = {
  id: 'clerk_organization_created',
  name: 'Clerk Organization Created',
  provider: 'clerk',
  description: 'Trigger workflow when a Clerk organization is created',
  version: '1.0.0',
  icon: ClerkIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'clerk_organization_created',
    triggerOptions: clerkTriggerOptions,
    setupInstructions: clerkSetupInstructions('organization.created'),
    extraFields: buildClerkExtraFields('clerk_organization_created'),
  }),

  outputs: buildOrganizationOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
