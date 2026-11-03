import { useState } from 'react'
import {
  AuthRoot,
  AuthShellView,
  AuthTextLink,
  AuthWordmark,
  AuthButton as Chip,
  AuthStatusContent as StatusPageContent,
} from '@sim/auth-ui'
import { observeDesktopTitleBar, type SimDesktopApi } from '@sim/desktop-bridge'
import { createRoot } from 'react-dom/client'
import '@/renderer/auth.css'

const ERROR_COPY = {
  offline: {
    title: 'You’re offline',
    message:
      'Sim needs an internet connection. Reconnect, then try again. We’ll also retry automatically.',
  },
  dns: {
    title: 'Can’t find the server',
    message:
      'The server address couldn’t be resolved. Check your connection or the configured server.',
  },
  tls: {
    title: 'Connection isn’t secure',
    message: 'The server’s TLS certificate couldn’t be verified, so the connection was refused.',
  },
  timeout: {
    title: 'The server isn’t responding',
    message: 'The connection timed out. The server may be down or your network may be blocking it.',
  },
  unreachable: {
    title: 'Can’t connect to Sim',
    message: 'Sim couldn’t reach the server. Check your internet connection, then try again.',
  },
} as const

const params = new URLSearchParams(location.search)
const kind = params.get('kind') ?? 'unreachable'
const copy = Object.hasOwn(ERROR_COPY, kind)
  ? ERROR_COPY[kind as keyof typeof ERROR_COPY]
  : ERROR_COPY.unreachable
const detail = params.get('detail')
const bridge = (window as Window & { simDesktop?: SimDesktopApi }).simDesktop

interface OfflinePageProps {
  isSimCloud: boolean
}

function OfflinePage({ isSimCloud }: OfflinePageProps) {
  const [actionError, setActionError] = useState('')

  async function checkStatus() {
    setActionError('')
    try {
      if (!(await bridge?.openExternal('https://status.sim.ai'))) {
        setActionError('Could not open the status page. Try again.')
      }
    } catch {
      setActionError('Could not open the status page. Try again.')
    }
  }

  return (
    <AuthRoot>
      <AuthShellView
        homeHref='https://sim.ai'
        logo={<AuthWordmark />}
        titlebar={<div data-auth-titlebar='' aria-hidden='true' />}
        footer={
          <AuthTextLink
            onClick={() => {
              void bridge?.openExternal('mailto:support@sim.ai')
            }}
          >
            Contact support
          </AuthTextLink>
        }
      >
        <StatusPageContent
          titleId='title'
          title={copy.title}
          description={copy.message}
          detail={
            <p
              id='detail'
              role='status'
              className='au:max-w-full au:break-words au:text-[var(--auth-secondary)] au:text-caption'
            >
              {actionError || detail}
            </p>
          }
        >
          <Chip fullWidth id='retry' variant='primary' onClick={() => bridge?.offlineRetry()}>
            Retry
          </Chip>
          {isSimCloud ? (
            <Chip fullWidth id='status' onClick={checkStatus}>
              Check status
            </Chip>
          ) : null}
          <Chip fullWidth variant='ghost' id='server' onClick={() => bridge?.server?.open()}>
            Change server
          </Chip>
        </StatusPageContent>
      </AuthShellView>
    </AuthRoot>
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('Offline page root is missing')
{
  observeDesktopTitleBar(document.documentElement, navigator.userAgent, bridge)
  const root = createRoot(container)
  root.render(<OfflinePage isSimCloud={false} />)
  void bridge?.server
    ?.getConfiguration()
    .then(({ isSimCloud }) => {
      root.render(<OfflinePage isSimCloud={isSimCloud} />)
    })
    .catch(() => {})
}
