'use client'

import { CredentialGroups } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/credential-groups'
import type { CredentialGroupsData } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/model'
import {
  type CredentialGroupManagement,
  useDatabricksConfiguration,
  useLiveCredentialGroupActions,
} from '@/platform/lib/data/credential-group-actions'

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
  return <CredentialGroups data={{ ...data, databricks }} actions={actions} shallow={false} />
}
