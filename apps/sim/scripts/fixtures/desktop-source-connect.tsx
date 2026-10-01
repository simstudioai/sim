import { StrictMode, useEffect, useRef, useState } from 'react'
import { ToastProvider } from '@sim/emcn'
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { isCredentialGroupOAuthFailure } from '@/lib/credential-groups/oauth-completion'
import { startDesktopSourceBrowser } from '@/lib/desktop/source-browser'
import { connectDesktopSource } from '@/lib/desktop/source-connect'
import { CredentialGroupCompletionHandoff } from '@/app/credential-groups/complete/completion-handoff'
import { SlackCompletion } from '@/app/credential-groups/slack-complete/slack-completion'
import { SourceCompletion } from '@/app/desktop/connect/source-completion'
import {
  useConnectOrganizationAccount,
  useOrganizationAccounts,
  useReconnectPersonalOrganizationAccount,
} from '@/hooks/queries/organization-accounts'
import { useSlackSearchInstallations, useStartSlackSearchOAuth } from '@/hooks/queries/slack-search'
import { useGitHubInstallationSetup } from '@/hooks/use-github-installation-setup'
import { useSearchIntegrationConnection } from '@/hooks/use-search-integration-connection'

function SourceConnectFixture() {
  const accountConnection = useConnectOrganizationAccount()
  const reconnect = useReconnectPersonalOrganizationAccount()
  const accounts = useOrganizationAccounts('fixture-organization')
  const enrollment = useMutation({
    mutationFn: () =>
      connectDesktopSource({
        kind: 'member-enrollment',
        params: { id: '00000000-0000-4000-8000-000000000001', connectorId: 'fixture-connector' },
      }),
  })
  const [githubCredential, setGithubCredential] = useState('')
  const github = useGitHubInstallationSetup({
    organizationId: 'fixture-organization',
    onConnected: setGithubCredential,
  })
  const slackAbort = useRef<AbortController | null>(null)
  const connection = useStartSlackSearchOAuth()
  const personal = useSearchIntegrationConnection({
    organizationId: 'fixture-organization',
    userId: 'fixture-user',
    controlId: 'fixture-search-card',
    target: {
      type: 'link',
      provider: 'slack',
      connectorType: 'slack',
      connectionMode: 'live',
      optionId: 'fixture-option',
    },
  })
  const inventory = useSlackSearchInstallations('fixture-organization')
  return (
    <main className='flex flex-col items-start gap-2 p-6'>
      <button
        disabled={accountConnection.isPending}
        onClick={() =>
          accountConnection.mutate({
            organizationId: 'fixture-organization',
            optionId: 'fixture-option',
          })
        }
      >
        Connect account
      </button>
      <button
        disabled={accountConnection.isPending}
        onClick={() =>
          accountConnection.mutate({
            organizationId: 'fixture-organization',
            mcpServerId: 'fixture-mcp',
          })
        }
      >
        Connect MCP account
      </button>
      <button disabled={reconnect.isPending} onClick={() => reconnect.mutate('fixture-account')}>
        Reconnect account
      </button>
      <output aria-label='Account authorization'>{accountConnection.status}</output>
      <output aria-label='Account error'>{accountConnection.error?.message}</output>
      <output aria-label='Reconnect status'>{reconnect.status}</output>
      <output aria-label='Reconnect error'>{reconnect.error?.message}</output>
      <output aria-label='Account count'>
        {(accounts.data?.viewerAccounts?.length ?? 0) +
          (accounts.data?.viewerMcpAccounts?.length ?? 0)}
      </output>
      <input aria-label='Source draft' defaultValue='Unsubmitted source name' />
      <button
        disabled={connection.isPending}
        onClick={() => {
          const controller = new AbortController()
          slackAbort.current = controller
          connection.mutate({
            signal: controller.signal,
            organizationId: 'fixture-organization',
            name: 'Search',
            description: 'Search fixture',
            mode: 'shared',
          })
        }}
      >
        Connect Slack
      </button>
      <button onClick={() => slackAbort.current?.abort()}>Cancel Slack request</button>
      <button
        disabled={
          personal.isLoading ||
          personal.isStarting ||
          personal.connected ||
          (!personal.available && !personal.pending)
        }
        onClick={() => void personal.connect()}
      >
        Connect personal Search
      </button>
      <button onClick={personal.cancel}>Cancel personal Search</button>
      <button onClick={() => void personal.retry()}>Retry personal inventory</button>
      <button disabled={github.pending} onClick={() => void github.connect()}>
        Connect GitHub
      </button>
      <output aria-label='GitHub pending'>{String(github.pending)}</output>
      <output aria-label='GitHub credential'>{githubCredential}</output>
      <output aria-label='GitHub error'>{github.error}</output>
      <button disabled={enrollment.isPending} onClick={() => enrollment.mutate()}>
        Connect invited source
      </button>
      <output aria-label='Enrollment pending'>{String(enrollment.isPending)}</output>
      <output aria-label='Enrollment error'>{enrollment.error?.message}</output>
      <output aria-label='Connection'>{connection.status}</output>
      <output aria-label='Accounts'>{inventory.data?.installations.length ?? 0}</output>
      {connection.error && <p role='alert'>{connection.error.message}</p>}
    </main>
  )
}

function BrowserLauncher() {
  const started = useRef<boolean>(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (started.current) return
    started.current = true
    const params = new URLSearchParams(location.search)
    void startDesktopSourceBrowser(
      params.get('sourceRequestId')!,
      params.get('state')!,
      Number(params.get('port'))
    ).catch((error: Error) => setError(error.message))
  }, [])
  return <p role='alert'>{error}</p>
}

const params = new URLSearchParams(location.search)
const oauth = params.get('oauth')
const failure = oauth === null ? undefined : isCredentialGroupOAuthFailure(oauth) ? oauth : 'failed'
const content =
  location.pathname === '/credential-groups/enroll/fixture-invitation' ? (
    params.has('connected') ? (
      <SourceCompletion kind='enrollment' id='fixture-invitation' />
    ) : (
      <a href='/credential-groups/enroll/fixture-invitation?connected=true'>
        Authorize invited source
      </a>
    )
  ) : location.pathname === '/credential-groups/complete' ? (
    <CredentialGroupCompletionHandoff
      completionId={params.get('completionId')!}
      failure={failure}
      returnHref={params.has('organizationId') ? '/o/fixture-organization/integrations' : undefined}
    />
  ) : location.pathname === '/desktop/connect' ? (
    <BrowserLauncher />
  ) : location.pathname === '/credential-groups/slack-complete' ? (
    <SlackCompletion
      mode='search'
      ok={params.get('ok') === 'true'}
      state={params.get('state') ?? undefined}
      reason={params.get('reason') ?? undefined}
    />
  ) : (
    <SourceConnectFixture />
  )
const root = document.getElementById('root')
if (!root) throw new Error('Missing fixture root')
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
        })
      }
    >
      <ToastProvider>{content}</ToastProvider>
    </QueryClientProvider>
  </StrictMode>
)
