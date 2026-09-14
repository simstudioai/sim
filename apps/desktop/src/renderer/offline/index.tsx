import { useState } from 'react'
import type { SimDesktopApi } from '@sim/desktop-bridge'
import { Chip } from '@sim/emcn'
import { ArrowUpRight, RefreshCw, Server, Wordmark } from '@sim/emcn/icons'
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
    <div className='flex min-h-screen flex-col pt-[38px]'>
      <header className='mx-auto w-full max-w-[1460px] px-8 py-4 [-webkit-app-region:drag] md:px-20'>
        <Wordmark
          role='img'
          aria-label='Sim'
          className='my-1.5 h-[18px] w-[37px] text-[var(--text-body)]'
        />
      </header>
      <main className='flex flex-1 items-center justify-center px-4 pb-16'>
        <div className='flex w-full max-w-[440px] flex-col items-center gap-3 text-center'>
          <h1 id='title' className='text-balance text-4xl leading-tight tracking-tight'>
            {copy.title}
          </h1>
          <p className='text-[var(--text-muted)] text-base'>{copy.message}</p>
          <div className='mt-3 flex flex-wrap justify-center gap-2'>
            <Chip
              id='retry'
              variant='primary'
              leftIcon={RefreshCw}
              onClick={() => bridge?.offlineRetry()}
            >
              Retry
            </Chip>
            {isSimCloud ? (
              <Chip id='status' leftIcon={ArrowUpRight} onClick={checkStatus}>
                Check status
              </Chip>
            ) : null}
            <Chip id='server' leftIcon={Server} onClick={() => bridge?.server?.open()}>
              Change server
            </Chip>
          </div>
          <p
            id='detail'
            role='status'
            className='max-w-full break-words font-mono text-[var(--text-muted)] text-caption'
          >
            {actionError || detail}
          </p>
        </div>
      </main>
    </div>
  )
}

initializeShellPage()
const container = document.getElementById('root')
if (!container) throw new Error('Offline page root is missing')
const root = createRoot(container)
root.render(<OfflinePage isSimCloud={false} />)
void bridge?.server
  ?.getConfiguration()
  .then(({ isSimCloud }) => {
    root.render(<OfflinePage isSimCloud={isSimCloud} />)
  })
  .catch(() => {})
