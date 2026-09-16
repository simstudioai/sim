import { McpIcon } from '@/components/icons'
import type {
  CredentialGroupEnrollmentConnection,
  CredentialGroupEnrollmentMcpConnection,
} from '@/lib/api/contracts/credential-groups'
import { getCredentialGroupProviderService } from '@/lib/credential-groups/providers'
import { resolveCredentialDisplay } from '@/lib/integrations/credential-display'

interface EnrollmentConnectionsProps {
  connections: CredentialGroupEnrollmentConnection[]
  mcpConnections: CredentialGroupEnrollmentMcpConnection[]
}

interface CredentialProviderIconProps {
  provider: CredentialGroupEnrollmentConnection['provider']
}

function CredentialProviderIcon({ provider }: CredentialProviderIconProps) {
  if (provider === 'gitlab') {
    const display = resolveCredentialDisplay({
      type: 'personal_token',
      providerId: provider,
      displayName: provider,
    })
    const Icon = display.icon
    return Icon ? <Icon className='size-[14px]' aria-label={display.detailTitle} /> : null
  }
  const ProviderIcon = getCredentialGroupProviderService(provider).icon
  return <ProviderIcon className='size-[14px]' aria-hidden />
}

export function EnrollmentConnections({ connections, mcpConnections }: EnrollmentConnectionsProps) {
  const connected = connections.filter((connection) => connection.status === 'active')
  const connectedMcp = mcpConnections.filter((connection) => connection.status === 'active')
  const count =
    connected.reduce((total, connection) => total + connection.count, 0) + connectedMcp.length
  const providers = [...new Set(connected.map((connection) => connection.provider))]

  return (
    <span className='flex items-center gap-1.5'>
      {providers.map((provider) => {
        return <CredentialProviderIcon key={provider} provider={provider} />
      })}
      {connectedMcp.length > 0 ? <McpIcon className='size-[14px]' aria-hidden /> : null}
      <span>
        {count} {count === 1 ? 'account' : 'accounts'} connected
      </span>
    </span>
  )
}
