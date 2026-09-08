import { type ReactNode, Suspense } from 'react'
import { Chip, ChipLink } from '@sim/emcn'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import type { ResourceOwner } from '@/lib/core/resource-scope'
import { resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { authenticateCredentialGroupEnrollment } from '@/lib/credential-groups/application/enrollment-auth'
import { readPublicCredentialGroupEnrollment } from '@/lib/credential-groups/application/public-enrollment'
import { CredentialGroupEnrollmentError } from '@/lib/credential-groups/enrollments'
import { getManagedMcpConnectorIcon } from '@/lib/credential-groups/managed-mcp-connector-icons'
import { CredentialGroupProviderConfigurationError } from '@/lib/credential-groups/provider-adapter'
import { getCredentialGroupProviderService } from '@/lib/credential-groups/providers'
import { enforcePublicCredentialGroupIpRateLimit } from '@/lib/credential-groups/rate-limit'
import { organizationRoutes } from '@/lib/navigation/paths'
import { SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'
import { AuthHeader, SupportFooter } from '@/app/(auth)/components'
import { LogoShell } from '@/app/(landing)/components'
import { OAuthConnectLink } from '@/app/credential-groups/enroll/[token]/oauth-reconnect-link'
import { CredentialGroupOAuthToast } from '@/app/credential-groups/enroll/[token]/oauth-toast'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

export const metadata: Metadata = {
  title: 'Connect accounts',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

interface CredentialGroupEnrollmentPageProps {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

interface PageShellProps {
  children: ReactNode
}

function PageShell({ children }: PageShellProps) {
  return (
    <LogoShell footer={<SupportFooter position='static' />}>
      <div className='mx-auto flex w-full max-w-[640px] flex-1 flex-col px-5 pt-16 pb-20 max-sm:pt-10'>
        {children}
      </div>
    </LogoShell>
  )
}

interface UnavailableInvitationProps {
  rateLimited?: boolean
  message?: string
}

function UnavailableInvitation({ rateLimited = false, message }: UnavailableInvitationProps) {
  return (
    <PageShell>
      <div className='my-auto py-16 text-center'>
        <AuthHeader
          title={rateLimited ? 'Too many requests' : 'Invitation unavailable'}
          description={
            message ??
            (rateLimited
              ? 'This link has been opened too many times. Wait a few minutes and try again.'
              : 'Sign in with the account this invitation was sent to. If the link has expired, ask an organization admin for a new invitation.')
          }
        />
      </div>
    </PageShell>
  )
}

interface UnavailableSearchConnectionProps {
  owner: ResourceOwner
}

function UnavailableSearchConnection({ owner }: UnavailableSearchConnectionProps) {
  return (
    <PageShell>
      <AuthHeader
        title='Connection unavailable'
        description='Ask a workspace admin to check this source’s connected account settings.'
      />
      <div className='mt-6 flex justify-end'>
        <ChipLink href={searchReturnPath(owner)}>Return to Search</ChipLink>
      </div>
    </PageShell>
  )
}

const OAUTH_MESSAGES = {
  denied: 'Authorization was canceled. Nothing was connected.',
  account_mismatch: 'Choose the account matching the email address on this invitation.',
  permissions_required: 'All requested permissions are required to connect this account.',
  configuration_changed: 'This credential option changed. Reload the page and try again.',
  rate_limited: 'Too many authorization attempts. Wait a few minutes and try again.',
  unavailable: 'Account authorization is temporarily unavailable. Please try again.',
  failed: 'Account authorization did not complete. Please try again.',
} as const

function getSearchParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  const value = searchParams[key]
  return Array.isArray(value) ? value[0] : value
}

export default async function CredentialGroupEnrollmentPage({
  params,
  searchParams,
}: CredentialGroupEnrollmentPageProps) {
  const requestHeaders = await headers()
  const limited = await enforcePublicCredentialGroupIpRateLimit(
    { headers: requestHeaders },
    'metadata'
  )
  if (limited) return <UnavailableInvitation rateLimited />

  const { token } = await params
  if (!token || token.length > 128) return <UnavailableInvitation />
  const resolvedSearchParams = await searchParams
  const session = await getSession()
  if (!session?.user) {
    const callback = new URLSearchParams()
    for (const key of ['returnTo', 'optionId']) {
      const value = getSearchParam(resolvedSearchParams, key)
      if (value) callback.set(key, value)
    }
    const callbackUrl = `/credential-groups/enroll/${encodeURIComponent(token)}${callback.size ? `?${callback}` : ''}`
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`)
  }
  if (!session.user.emailVerified)
    return (
      <UnavailableInvitation message='Verify your Sim email address before connecting your accounts.' />
    )
  const principal = await authenticateCredentialGroupEnrollment(token)
  if (!principal) return <UnavailableInvitation />
  const returnToSearch = resolvedSearchParams.returnTo === 'search'
  const requestedOptionId = resolvedSearchParams.optionId
  const focusedOptionId =
    typeof requestedOptionId === 'string' && requestedOptionId.length <= 128
      ? requestedOptionId
      : ''
  const enrollmentResult = await readPublicCredentialGroupEnrollment
    .execute({ principal, input: returnToSearch ? { optionId: focusedOptionId } : {} })
    .catch((error: unknown) => {
      if (error instanceof CredentialGroupEnrollmentError)
        return { enrollment: null, enrollmentError: error.message }
      if (asOrchestrationError(error)?.code === 'not_found') return null
      if (returnToSearch && error instanceof CredentialGroupProviderConfigurationError)
        return { enrollment: null }
      throw error
    })
  if (!enrollmentResult) return <UnavailableInvitation />
  if ('enrollmentError' in enrollmentResult)
    return <UnavailableInvitation message={enrollmentResult.enrollmentError} />
  const { enrollment } = enrollmentResult
  if (!enrollment) return <UnavailableSearchConnection owner={principal} />

  const oauthStatus = getSearchParam(resolvedSearchParams, 'oauth')
  const connectedOptionId = getSearchParam(resolvedSearchParams, 'connected')
  const connectedMcpServerId =
    getSearchParam(resolvedSearchParams, 'mcp') === 'connected'
      ? getSearchParam(resolvedSearchParams, 'mcpServerId')
      : undefined
  const oauthMessage =
    oauthStatus && Object.hasOwn(OAUTH_MESSAGES, oauthStatus)
      ? OAUTH_MESSAGES[oauthStatus as keyof typeof OAUTH_MESSAGES]
      : null
  const activeOptions = enrollment.options.filter((option) => option.status === 'active')
  const focusedOption = returnToSearch
    ? activeOptions.find((option) => option.id === focusedOptionId)
    : undefined
  if (returnToSearch && !focusedOption) return <UnavailableSearchConnection owner={principal} />
  const visibleOptions = focusedOption ? [focusedOption] : activeOptions
  const focusedConnected = focusedOption?.connections[0]?.status === 'connected'
  const focusedProviderId = focusedOption
    ? getCredentialGroupProviderService(focusedOption.provider).providerId
    : undefined
  const docsUrl = focusedProviderId
    ? SEARCH_CONNECTORS.find((connector) => connector.providerIds.includes(focusedProviderId))?.meta
        .searchDocsUrl
    : undefined
  const connectedOption = connectedOptionId
    ? activeOptions.find((option) => option.id === connectedOptionId)
    : undefined
  const connectedMcpServer = connectedMcpServerId
    ? enrollment.mcpServers.find((server) => server.id === connectedMcpServerId)
    : undefined
  const notification =
    !returnToSearch && connectedMcpServerId
      ? {
          message: `${connectedMcpServer?.name ?? 'MCP server'} connected successfully.`,
          variant: 'success' as const,
        }
      : connectedOptionId &&
          (!returnToSearch || (connectedOptionId === focusedOption?.id && focusedConnected))
        ? {
            message: `${connectedOption ? getCredentialGroupProviderService(connectedOption.provider).name : 'Account'} connected successfully.`,
            variant: 'success' as const,
          }
        : oauthMessage
          ? { message: oauthMessage, variant: 'error' as const }
          : null
  return (
    <PageShell>
      {notification && (
        <Suspense fallback={null}>
          <CredentialGroupOAuthToast {...notification} />
        </Suspense>
      )}
      <AuthHeader
        title={
          focusedOption
            ? focusedConnected
              ? `${getCredentialGroupProviderService(focusedOption.provider).name} connected`
              : `Connect your ${getCredentialGroupProviderService(focusedOption.provider).name} account`
            : 'Connect your accounts'
        }
        description={
          returnToSearch
            ? `${focusedConnected ? 'Your account is connected for' : 'Connect your account for'} ${enrollment.workspaceName}.`
            : `${enrollment.inviterName ? `${enrollment.inviterName} invited you` : 'You have been invited'} to connect accounts for ${enrollment.workspaceName}.`
        }
      />

      <div className='mt-8'>
        <SettingsSection label='Accounts'>
          <div className={RESOURCE_LIST_STACK}>
            {visibleOptions.map((option) => {
              const ProviderIcon = getCredentialGroupProviderService(option.provider).icon
              const connection = option.connections[0]
              return (
                <SettingsResourceRow
                  key={option.id}
                  icon={<ProviderIcon />}
                  title={option.label}
                  description={
                    returnToSearch && connection?.status === 'connected'
                      ? `${connection.email} · Connected`
                      : (connection?.email ?? 'Not connected')
                  }
                  trailing={
                    returnToSearch && connection?.status === 'connected' ? undefined : (
                      <OAuthConnectLink
                        href={`/api/credential-groups/enroll/${encodeURIComponent(token)}/oauth/${encodeURIComponent(option.id)}${returnToSearch ? '?returnTo=search' : ''}`}
                        reconnect={Boolean(connection)}
                        variant={returnToSearch ? 'primary' : undefined}
                      />
                    )
                  }
                />
              )
            })}
            {!returnToSearch &&
              enrollment.mcpServers.map((server) => {
                const ConnectorIcon = getManagedMcpConnectorIcon(server.managedConnectorId)
                return (
                  <SettingsResourceRow
                    key={server.id}
                    icon={<ConnectorIcon />}
                    title={server.name}
                    description={
                      server.connection?.status === 'connected'
                        ? 'Connected'
                        : server.connection
                          ? 'Reconnect required'
                          : server.description || 'Not connected'
                    }
                    trailing={
                      <OAuthConnectLink
                        href={`/api/credential-groups/enroll/${token}/mcp/${server.id}`}
                        reconnect={Boolean(server.connection)}
                      />
                    }
                  />
                )
              })}
          </div>
        </SettingsSection>
        {returnToSearch ? (
          <div className='mt-6 flex justify-end gap-2'>
            {docsUrl && (
              <ChipLink href={docsUrl} target='_blank' rel='noopener noreferrer'>
                Setup guide
              </ChipLink>
            )}
            <ChipLink
              href={searchReturnPath(principal)}
              variant={focusedConnected ? 'primary' : undefined}
            >
              Return to Search
            </ChipLink>
          </div>
        ) : (
          <form
            action={`/api/credential-groups/enroll/${token}/complete`}
            method='post'
            className='mt-6 flex justify-end'
          >
            <Chip type='submit' variant='primary' disabled={enrollment.status === 'completed'}>
              {enrollment.status === 'completed' ? 'Submitted' : 'Submit'}
            </Chip>
          </form>
        )}
      </div>
    </PageShell>
  )
}

function searchReturnPath(owner: ResourceOwner): string {
  const scope = resourceScopeFromOwner(owner)
  return scope.kind === 'workspace'
    ? `/workspace/${encodeURIComponent(scope.workspaceId)}/search`
    : organizationRoutes(scope.organizationId).integrations
}
