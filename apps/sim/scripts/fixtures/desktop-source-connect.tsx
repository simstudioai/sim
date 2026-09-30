import { StrictMode, useEffect, useRef, useState } from 'react'
import { ToastProvider } from '@sim/emcn'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { startDesktopSourceBrowser } from '@/lib/desktop/source-browser'
import { CredentialGroupCompletionHandoff } from '@/app/credential-groups/complete/completion-handoff'
import { SlackCompletion } from '@/app/credential-groups/slack-complete/slack-completion'
import { useSlackSearchInstallations, useStartSlackSearchOAuth } from '@/hooks/queries/slack-search'
import { useGitHubInstallationSetup } from '@/hooks/use-github-installation-setup'

function SourceConnectFixture() {
  const [githubCredential, setGithubCredential] = useState('')
  const github = useGitHubInstallationSetup({
    organizationId: 'fixture-organization',
    onConnected: setGithubCredential,
  })
  const connection = useStartSlackSearchOAuth()
  const inventory = useSlackSearchInstallations('fixture-organization')
  return (
    <main>
      <input aria-label='Source draft' defaultValue='Unsubmitted source name' />
      <button
        disabled={connection.isPending}
        onClick={() =>
          connection.mutate({
            organizationId: 'fixture-organization',
            name: 'Search',
            description: 'Search fixture',
            mode: 'shared',
          })
        }
      >
        Connect Slack
      </button>
      <button disabled={github.pending} onClick={() => void github.connect()}>
        Connect GitHub
      </button>
      <output aria-label='GitHub pending'>{String(github.pending)}</output>
      <output aria-label='GitHub credential'>{githubCredential}</output>
      <output aria-label='GitHub error'>{github.error}</output>
      <output aria-label='Connection'>{connection.status}</output>
      <output aria-label='Accounts'>{inventory.data?.installations.length ?? 0}</output>
      {connection.error && <p role='alert'>{connection.error.message}</p>}
    </main>
  )
}

function BrowserLauncher() {
  const started = useRef(false)
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
const content =
  location.pathname === '/credential-groups/complete' ? (
    <CredentialGroupCompletionHandoff completionId={params.get('completionId')!} />
  ) : location.pathname === '/desktop/connect' ? (
    <BrowserLauncher />
  ) : location.pathname === '/credential-groups/slack-complete' ? (
    <SlackCompletion
      mode='search'
      ok={params.get('ok') === 'true'}
      state={params.get('state') ?? undefined}
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
