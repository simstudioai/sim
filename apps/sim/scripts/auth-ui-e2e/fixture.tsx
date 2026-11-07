import { useState } from 'react'
import { Wordmark } from '@sim/emcn/brand/wordmark'
import { AuthCodeEntry } from '@sim/emcn-auth/code-entry'
import { AuthField } from '@sim/emcn-auth/field'
import { PasswordInput } from '@sim/emcn-auth/input'
import { AuthRoot } from '@sim/emcn-auth/root'
import { AuthSelect } from '@sim/emcn-auth/select'
import { AuthShellView } from '@sim/emcn-auth/shell'
import { AuthStack } from '@sim/emcn-auth/stack'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { OAuthConsentView } from '@/app/(auth)/oauth/consent/consent-view'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

function Controls() {
  const [workspace, setWorkspace] = useState('engineering')
  const [provider, setProvider] = useState('google')
  const [code, setCode] = useState('')
  const [verified, setVerified] = useState(false)
  return (
    <AuthStack>
      <AuthField htmlFor='workspace' label='Workspace'>
        <AuthSelect
          id='workspace'
          aria-label='Workspace'
          searchable
          value={workspace}
          onChange={setWorkspace}
          options={[
            { value: 'disabled', label: 'Archived workspace', disabled: true },
            { value: 'engineering', label: 'Engineering' },
            { value: 'design', label: 'Design' },
            { value: 'operations', label: 'Operations' },
          ]}
        />
      </AuthField>
      <AuthField htmlFor='provider' label='Provider'>
        <AuthSelect
          id='provider'
          aria-label='Provider'
          value={provider}
          onChange={setProvider}
          options={[
            { value: 'google', label: 'Google' },
            { value: 'disabled', label: 'Unavailable', disabled: true },
            { value: 'microsoft', label: 'Microsoft' },
          ]}
        />
      </AuthField>
      <AuthField htmlFor='password' label='Password'>
        <PasswordInput id='password' defaultValue='fixture-password' />
      </AuthField>
      {verified ? (
        <p role='status'>Verification submitted</p>
      ) : (
        <AuthCodeEntry
          value={code}
          onChange={setCode}
          onVerify={() => setVerified(true)}
          verifying={false}
          resending={false}
          countdown={0}
        />
      )}
    </AuthStack>
  )
}

const query = new URLSearchParams(window.location.search)
const root = document.getElementById('root')
if (!root) throw new Error('Missing browser fixture root')
createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <AuthRoot>
      <AuthShellView homeHref='/' logo={<Wordmark />}>
        {window.location.pathname === '/controls' ? (
          <Controls />
        ) : (
          <OAuthConsentView
            refusal={query.get('refused') ? 'tampered' : null}
            clientId={query.get('client_id') ?? 'codex'}
            authorizationRequestKey={window.location.search || 'fixture'}
            scope='offline_access api:write'
            redirectUri='http://127.0.0.1:1455/return'
            email={
              query.has('stress') ? `${'long-email-'.repeat(12)}@example.test` : 'emir@example.test'
            }
          />
        )}
      </AuthShellView>
    </AuthRoot>
  </QueryClientProvider>
)
