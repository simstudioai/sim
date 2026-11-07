'use client'

import { Chip } from '@sim/emcn-legacy'
import type { ViewerConnectorMembership } from '@/lib/api/contracts/knowledge/connectors'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useStartConnectorMemberEnrollment } from '@/hooks/queries/kb/connectors'

type UnconnectedMembership = Exclude<ViewerConnectorMembership, 'connected'>

/** Revoked and unverified viewers get the server's refusal as the row, with no action to retry. */
const MEMBERSHIP_STATES: Record<UnconnectedMembership, { title: string; action?: string }> = {
  not_enrolled: { title: 'Your account is not connected', action: 'Connect your account' },
  invited: { title: 'Your account is not connected', action: 'Connect your account' },
  needs_reauth: { title: 'Your account needs to be reconnected', action: 'Reconnect' },
  revoked: { title: 'An admin removed your access to Connected accounts' },
  unverified_email: { title: 'Verify your email address before connecting an account' },
}

interface ConnectorMemberEnrollmentProps {
  knowledgeBaseId: string
  connectorId: string
  isSearchIndex: boolean
  membership: UnconnectedMembership
}

export function ConnectorMemberEnrollment({
  knowledgeBaseId,
  connectorId,
  isSearchIndex,
  membership,
}: ConnectorMemberEnrollmentProps) {
  const enrollment = useStartConnectorMemberEnrollment()
  const { title, action } = MEMBERSHIP_STATES[membership]

  return (
    <>
      <SettingsResourceRow
        title={title}
        trailing={
          action ? (
            <Chip
              disabled={enrollment.isPending}
              onClick={() =>
                enrollment.mutate({ knowledgeBaseId, connectorId, directOAuth: isSearchIndex })
              }
            >
              {action}
            </Chip>
          ) : undefined
        }
      />
      {enrollment.error && (
        <p role='alert' className='text-[var(--text-error)] text-caption'>
          {enrollment.error.message}
        </p>
      )}
    </>
  )
}
