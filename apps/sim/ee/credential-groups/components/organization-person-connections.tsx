import { ChipTag } from '@sim/emcn'
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

export function OrganizationPersonConnections({ person }: OrganizationPersonConnectionsProps) {
  if (person.status === 'revoked') return <>Access revoked</>

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
      icon: service?.icon ?? display?.icon,
      status: connection.status,
      count: connection.count,
    }
  })
  const total =
    connections.reduce(
      (count, connection) => count + (connection.status === 'active' ? connection.count : 0),
      0
    ) + person.mcpConnections.filter((connection) => connection.status === 'active').length

  const statuses = [...connections, ...person.mcpConnections].map(({ status }) => status)

  return (
    <span className='flex flex-col gap-1.5'>
      <span>
        {total > 0
          ? `${total} ${total === 1 ? 'account' : 'accounts'} connected`
          : statuses.includes('needs_reauth')
            ? 'Reconnect required'
            : statuses.includes('revoked')
              ? 'Disconnected'
              : person.status === 'delivery_failed'
                ? 'Connection request failed'
                : person.expired
                  ? 'Connection request expired'
                  : 'Not connected'}
      </span>
      {(connections.length > 0 || person.mcpConnections.length > 0) && (
        <span className='flex flex-wrap gap-1'>
          {connections.map(({ key, name, icon: Icon, status, count }) => (
            <ChipTag
              key={key}
              variant='gray'
              title={`${name}: ${CONNECTION_STATUS_LABELS[status]}`}
            >
              {Icon && <Icon className='size-[14px]' />}
              {name}
              {count > 1 ? ` (${count})` : ''}
              {status !== 'active' && ` · ${CONNECTION_STATUS_LABELS[status]}`}
            </ChipTag>
          ))}
          {person.mcpConnections.map((connection) => (
            <ChipTag key={connection.mcpServerId} variant='gray'>
              {connection.name} · {CONNECTION_STATUS_LABELS[connection.status]}
            </ChipTag>
          ))}
        </span>
      )}
    </span>
  )
}
