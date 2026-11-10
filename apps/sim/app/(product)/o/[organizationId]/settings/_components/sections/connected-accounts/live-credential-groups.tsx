'use client'

import { CredentialGroups } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/credential-groups'
import { SlackMemberSetup } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/slack-member-setup'
import {
  type CredentialGroupManagement,
  useDatabricksConfiguration,
  useLiveCredentialGroupActions,
} from '@/platform/lib/data/credential-group-actions'
import type { CredentialGroupsData } from '@/platform/lib/data/models/connected-accounts'

interface LiveCredentialGroupsProps {
  organizationId: string
  data: CredentialGroupsData
  management: CredentialGroupManagement
}

/** Credential Groups on live data: read on the server, edited through the account mutations. */
export function LiveCredentialGroups({
  organizationId,
  data,
  management,
}: LiveCredentialGroupsProps) {
  const actions = useLiveCredentialGroupActions(organizationId, management)
  const databricks = useDatabricksConfiguration(organizationId, management.databricksConfigured)
  const { groupId } = management
  return (
    <CredentialGroups
      data={{ ...data, databricks }}
      actions={actions}
      shallow={false}
      renderSlackSetup={(_provider, onClose) =>
        groupId && (
          <SlackMemberSetup
            organizationId={organizationId}
            credentialGroupId={groupId}
            onClose={onClose}
          />
        )
      }
    />
  )
}
