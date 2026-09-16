import { useState } from 'react'
import { observeDesktopTitleBar, type SimDesktopApi } from '@sim/desktop-bridge'
import { Chip, LogoPage, SimWordmark, StatusPageContent } from '@sim/emcn'
import { createRoot } from 'react-dom/client'
import { initializeShellPage } from '@/renderer/shell'
import '@/renderer/shell.css'

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
    <LogoPage
      center
      className='desktop-title-bar-page'
      titleBar={
        <div aria-hidden className='desktop-login-window-drag-region desktop-window-drag-region' />
      }
      logo={
        <span role='img' aria-label='Sim' className='flex h-[30px] items-center'>
          <SimWordmark />
        </span>
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
            className='max-w-full break-words text-[var(--text-muted)] text-caption'
          >
            {actionError || detail}
          </p>
        }
      >
        <Chip id='retry' variant='primary' onClick={() => bridge?.offlineRetry()}>
          Retry
        </Chip>
        {isSimCloud ? (
          <Chip id='status' onClick={checkStatus}>
            Check status
          </Chip>
        ) : null}
        <Chip id='server' onClick={() => bridge?.server?.open()}>
          Change server
        </Chip>
      </StatusPageContent>
    </LogoPage>
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('Offline page root is missing')
void initializeShellPage().then(() => {
  observeDesktopTitleBar(document.documentElement, navigator.userAgent, bridge)
  const root = createRoot(container)
  root.render(<OfflinePage isSimCloud={false} />)
  void bridge?.server
    ?.getConfiguration()
    .then(({ isSimCloud }) => {
      root.render(<OfflinePage isSimCloud={isSimCloud} />)
    })
    .catch(() => {})
})
