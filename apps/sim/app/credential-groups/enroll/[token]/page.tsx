import { type ReactNode, Suspense } from 'react'
import { Chip } from '@sim/emcn'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { authenticateCredentialGroupEnrollment } from '@/lib/credential-groups/application/enrollment-auth'
import { readPublicCredentialGroupEnrollment } from '@/lib/credential-groups/application/public-enrollment'
import {
  getCredentialGroupProviderPresentation,
  isCredentialGroupApiKeyProvider,
} from '@/lib/credential-groups/providers'
import { enforcePublicCredentialGroupIpRateLimit } from '@/lib/credential-groups/rate-limit'
import { SupportFooter } from '@/app/(auth)/components'
import { LogoShell } from '@/app/(landing)/components'
import { ApiKeyConnectModal } from '@/app/credential-groups/enroll/[token]/api-key-connect-modal'
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

function UnavailableInvitation({ rateLimited = false }: { rateLimited?: boolean }) {
  return (
    <PageShell>
      <div className='my-auto py-16 text-center'>
        <h1 className='text-balance text-[32px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em]'>
          {rateLimited ? 'Too many requests' : 'Invitation unavailable'}
        </h1>
        <p className='mx-auto mt-3 max-w-[440px] text-pretty text-[var(--text-muted)] text-base leading-relaxed'>
          {rateLimited
            ? 'This link has been opened too many times. Wait a few minutes and try again.'
            : 'This private link is invalid, expired, or has been revoked. Ask the workspace admin to send a new invitation.'}
        </p>
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

  const principal = await authenticateCredentialGroupEnrollment(token)
  if (!principal) return <UnavailableInvitation />
  const enrollmentResult = await readPublicCredentialGroupEnrollment
    .execute({ principal, input: {} })
    .catch((error: unknown) => {
      if (asOrchestrationError(error)?.code === 'not_found') return null
      throw error
    })
  if (!enrollmentResult) return <UnavailableInvitation />
  const { enrollment } = enrollmentResult

  const resolvedSearchParams = await searchParams
  const oauthStatus = getSearchParam(resolvedSearchParams, 'oauth')
  const connectedOptionId = getSearchParam(resolvedSearchParams, 'connected')
  const oauthMessage =
    oauthStatus && oauthStatus in OAUTH_MESSAGES
      ? OAUTH_MESSAGES[oauthStatus as keyof typeof OAUTH_MESSAGES]
      : null
  const activeOptions = enrollment.options.filter((option) => option.status === 'active')
  const connectedOption = connectedOptionId
    ? activeOptions.find((option) => option.id === connectedOptionId)
    : undefined
  const notification = connectedOptionId
    ? {
        message: `${connectedOption ? getCredentialGroupProviderPresentation(connectedOption.provider).name : 'Account'} connected successfully.`,
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
      <header>
        <h1 className='text-balance text-[36px] text-[var(--text-primary)] leading-[108%] tracking-[-0.025em] max-sm:text-[32px]'>
          Connect your accounts
        </h1>
        <p className='mt-4 max-w-[560px] text-pretty text-[var(--text-muted)] text-base leading-relaxed'>
          {enrollment.inviterName ? (
            <>
              <span className='font-medium text-[var(--text-body)]'>{enrollment.inviterName}</span>{' '}
              invited you
            </>
          ) : (
            'You have been invited'
          )}{' '}
          to connect accounts for{' '}
          <span className='font-medium text-[var(--text-body)]'>{enrollment.workspaceName}</span>.
        </p>
      </header>

      <div className='mt-8'>
        <SettingsSection label='Accounts'>
          <div className={RESOURCE_LIST_STACK}>
            {activeOptions.map((option) => {
              const ProviderIcon = getCredentialGroupProviderPresentation(option.provider).icon
              const connection = option.connections[0]
              if (isCredentialGroupApiKeyProvider(option.provider)) {
                const provider = option.provider
                return (
                  <SettingsResourceRow
                    key={option.id}
                    icon={<ProviderIcon />}
                    title={option.label}
                    description={
                      connection
                        ? `Connected${connection.email ? ` as ${connection.email}` : ''}`
                        : 'Not connected'
                    }
                    trailing={
                      <ApiKeyConnectModal
                        token={token}
                        optionId={option.id}
                        provider={provider}
                        connected={Boolean(connection)}
                      />
                    }
                  />
                )
              }
              return (
                <SettingsResourceRow
                  key={option.id}
                  icon={<ProviderIcon />}
                  title={option.label}
                  description={connection?.email ?? 'Not connected'}
                  trailing={
                    <OAuthConnectLink
                      href={`/api/credential-groups/enroll/${token}/oauth/${option.id}`}
                      reconnect={Boolean(connection)}
                    />
                  }
                />
              )
            })}
          </div>
        </SettingsSection>
        <form
          action={`/api/credential-groups/enroll/${token}/complete`}
          method='post'
          className='mt-6 flex justify-end'
        >
          <Chip type='submit' variant='primary' disabled={enrollment.status === 'completed'}>
            {enrollment.status === 'completed' ? 'Submitted' : 'Submit'}
          </Chip>
        </form>
      </div>
    </PageShell>
  )
}
