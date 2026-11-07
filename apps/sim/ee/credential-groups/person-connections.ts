import type { CredentialGroupEnrollmentDetail } from '@/lib/api/contracts/credential-groups'
import { getCredentialGroupProviderService } from '@/lib/credential-groups/providers'
import { resolveCredentialDisplay } from '@/lib/integrations/credential-display'

/** The accounts a person has connected, or none once their enrollment is revoked. */
export function personConnectionSummaries(person: CredentialGroupEnrollmentDetail) {
  if (person.status === 'revoked') return []
  return [
    ...person.connections
      .filter((connection) => connection.status === 'active')
      .map((connection) => {
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
          providerId: connection.provider as string | undefined,
          name: service?.name ?? display?.detailTitle ?? 'GitLab',
          icon: service?.icon ?? display?.icon ?? undefined,
          count: connection.count,
        }
      }),
    ...person.mcpConnections
      .filter((connection) => connection.status === 'active')
      .map((connection) => ({
        key: `mcp:${connection.mcpServerId}`,
        providerId: undefined,
        name: connection.name,
        count: connection.count,
        icon: undefined,
      })),
  ]
}
