import { ChipTag, OverflowText } from '@sim/emcn'
import type { CredentialGroupEnrollmentDetail } from '@/lib/api/contracts/credential-groups'
import { getCredentialGroupProviderService } from '@/lib/credential-groups/providers'
import { resolveCredentialDisplay } from '@/lib/integrations/credential-display'

interface OrganizationPersonConnectionsProps {
  person: CredentialGroupEnrollmentDetail
}

const CONNECTION_STATUS_LABELS = {
  active: 'Connected',
  needs_reauth: 'Reconnect required',
  revoked: 'Disconnected',
} as const

export function getOrganizationPersonConnectionSummary(person: CredentialGroupEnrollmentDetail) {
  if (person.status === 'revoked') return 'Access revoked'

  const connected =
    person.connections.reduce(
      (count, connection) => count + (connection.status === 'active' ? connection.count : 0),
      0
    ) + person.mcpConnections.filter((connection) => connection.status === 'active').length
  if (connected > 0) return `${connected} ${connected === 1 ? 'account' : 'accounts'} connected`

  const statuses = [...person.connections, ...person.mcpConnections].map(({ status }) => status)
  if (statuses.includes('needs_reauth')) return 'Reconnect required'
  if (statuses.includes('revoked')) return 'Disconnected'
  if (person.status === 'delivery_failed') return 'Connection request failed'
  if (person.expired) return 'Connection request expired'
  return 'Not connected'
}

export function OrganizationPersonConnections({ person }: OrganizationPersonConnectionsProps) {
  if (person.status === 'revoked') return null

  const connections = person.connections.map((connection) => {
    const display =
      connection.provider === 'gitlab'
        ? resolveCredentialDisplay({
            type: 'personal_token',
            providerId: 'gitlab',
            displayName: 'GitLab',
          })
        : undefined
    const service =
      connection.provider !== 'gitlab'
        ? getCredentialGroupProviderService(connection.provider)
        : undefined
    return {
      key: `${connection.provider}:${connection.status}`,
      name: service?.name ?? display?.detailTitle ?? 'GitLab',
      icon: service?.icon ?? display?.icon ?? undefined,
      status: connection.status,
      count: connection.count,
    }
  })
  const accounts = [
    ...connections,
    ...person.mcpConnections.map((connection) => ({
      key: `mcp:${connection.mcpServerId}`,
      name: connection.name,
      status: connection.status,
      count: 1,
      icon: undefined,
    })),
  ]

  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      {(['active', 'needs_reauth', 'revoked'] as const).map((status) => {
        const matching = accounts.filter((account) => account.status === status)
        if (matching.length === 0) return null
        return (
          <div key={status} role='group' aria-label={CONNECTION_STATUS_LABELS[status]}>
            {status !== 'active' && (
              <p className='mb-1 text-[var(--text-muted)] text-caption'>
                {CONNECTION_STATUS_LABELS[status]}
              </p>
            )}
            <div className='flex min-w-0 flex-wrap gap-1'>
              {matching.map(({ key, name, icon, count }) => (
                <ChipTag key={key} variant='gray' leftIcon={icon} className='max-w-full'>
                  <OverflowText label={count > 1 ? `${name} (${count})` : name} />
                </ChipTag>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
