import { useEffect, useRef, useState } from 'react'
import {
  appToExtensionMessageSchema,
  type ExtensionToAppMessage,
  type PageSnapshot,
} from '@sim/browser-extension-protocol'
import {
  Button,
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { Globe, MoreHorizontal } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { createRoot } from 'react-dom/client'
import { captureActivePage } from '@/capture'
import { CAPTURE_INTENT_KEY, CAPTURE_INTENT_TTL_MS, SIM_ORIGIN } from '@/config'
import { captureIntentSchema } from '@/intent'
import '@/shell.css'

interface SidePanelProps {
  origin: string
}

function SidePanel({ origin }: SidePanelProps) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const pendingRef = useRef<PageSnapshot | null>(null)
  const sessionRef = useRef<string | null>(null)
  const deliveredRef = useRef<string | null>(null)
  const captureGenerationRef = useRef(0)
  const intentCutoffRef = useRef(0)
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [site, setSite] = useState<{ origin: string; allowed: boolean } | null>(null)

  function deliver() {
    const snapshot = pendingRef.current
    const sessionId = sessionRef.current
    if (!snapshot || !sessionId || deliveredRef.current === snapshot.id) return
    if (Date.now() - Date.parse(snapshot.capturedAt) > CAPTURE_INTENT_TTL_MS) {
      pendingRef.current = null
      setStatus('The capture expired. Attach the page again.')
      return
    }
    const message: ExtensionToAppMessage = {
      channel: 'sim-extension',
      version: 1,
      type: 'context',
      sessionId,
      snapshot,
    }
    frameRef.current?.contentWindow?.postMessage(message, SIM_ORIGIN)
    deliveredRef.current = snapshot.id
  }

  function invalidateSession() {
    intentCutoffRef.current = Date.now()
    if (pendingRef.current || busyRef.current)
      setStatus('The conversation changed before delivery. Attach the page again.')
    captureGenerationRef.current++
    pendingRef.current = null
    deliveredRef.current = null
    sessionRef.current = null
    busyRef.current = false
    setBusy(false)
  }

  async function capture(
    kind: 'page' | 'selection',
    expected?: { tabId: number; documentId: string; urlDigest: string }
  ) {
    if (busyRef.current) return
    if (pendingRef.current) {
      setStatus('Waiting for Sim to receive the previous capture. Try again after it appears.')
      return
    }
    busyRef.current = true
    setBusy(true)
    const generation = ++captureGenerationRef.current
    setStatus('Reading the page…')
    try {
      const snapshot = await captureActivePage(kind, expected)
      if (generation !== captureGenerationRef.current) return
      pendingRef.current = snapshot
      setStatus('Waiting for Sim to receive the attachment…')
      deliver()
    } catch (error) {
      if (generation === captureGenerationRef.current)
        setStatus(
          getErrorMessage(
            error,
            'Could not read this page. Click the Sim toolbar icon and try again.'
          )
        )
    } finally {
      if (generation === captureGenerationRef.current) {
        busyRef.current = false
        setBusy(false)
      }
    }
  }

  useEffect(() => {
    let disposed = false
    let appTheme: 'light' | 'dark' | undefined
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const theme = appTheme ?? (systemTheme.matches ? 'dark' : 'light')
      document.documentElement.classList.toggle('dark', theme === 'dark')
      document.documentElement.classList.toggle('light', theme === 'light')
    }
    applyTheme()
    systemTheme.addEventListener('change', applyTheme)
    let metadataGeneration = 0
    const updateSite = async () => {
      const generation = ++metadataGeneration
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      let next: { origin: string; allowed: boolean } | null = null
      if (tab?.url && !tab.incognito) {
        const url = new URL(tab.url)
        if (['http:', 'https:'].includes(url.protocol) && url.origin !== SIM_ORIGIN) {
          next = {
            origin: url.origin,
            allowed: await chrome.permissions.contains({ origins: [`${url.origin}/*`] }),
          }
        }
      }
      if (!disposed && generation === metadataGeneration) setSite(next)
    }
    const update = () => {
      void updateSite().catch(() => {
        if (!disposed) setSite(null)
      })
    }
    let consumingIntent = false
    const consumeIntent = async () => {
      if (disposed || consumingIntent || busyRef.current || pendingRef.current) return
      consumingIntent = true
      try {
        const window = await chrome.windows.getCurrent()
        if (window.id === undefined) return
        const stored = await chrome.storage.session.get(null)
        if (disposed || busyRef.current || pendingRef.current) return
        const keys = Object.keys(stored).filter((key) =>
          key.startsWith(`${CAPTURE_INTENT_KEY}:${window.id}:`)
        )
        const intents = keys
          .flatMap((key) => {
            const intent = captureIntentSchema.safeParse(stored[key])
            return intent.success && intent.data.windowId === window.id ? [intent.data] : []
          })
          .sort((left, right) => right.createdAt - left.createdAt)
        if (keys.length) await chrome.storage.session.remove(keys)
        const intent = intents[0]
        if (intent && intent.createdAt <= intentCutoffRef.current) {
          if (!disposed)
            setStatus(
              'A capture from the previous conversation was discarded. Attach the page again.'
            )
          return
        }
        if (!disposed && intent && Date.now() - intent.createdAt <= CAPTURE_INTENT_TTL_MS)
          await capture(intent.kind, intent)
      } catch {
        if (!disposed) setStatus('Could not receive the capture request. Attach the page again.')
      } finally {
        consumingIntent = false
      }
    }
    const storageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      if (area === 'session' && Object.values(changes).some((change) => change.newValue))
        void consumeIntent()
    }
    const message = (event: MessageEvent<unknown>) => {
      if (event.origin !== SIM_ORIGIN || event.source !== frameRef.current?.contentWindow) return
      const parsed = appToExtensionMessageSchema.safeParse(event.data)
      if (!parsed.success) return
      if (parsed.data.type === 'theme') {
        appTheme = parsed.data.theme
        applyTheme()
      } else if (parsed.data.type === 'ready') {
        if (sessionRef.current && sessionRef.current !== parsed.data.sessionId) invalidateSession()
        sessionRef.current = parsed.data.sessionId
        deliver()
      } else if (parsed.data.sessionId !== sessionRef.current) {
        return
      } else if (parsed.data.type === 'unavailable') {
        invalidateSession()
      } else if (pendingRef.current?.id === parsed.data.snapshotId) {
        pendingRef.current = null
        setStatus('')
        void consumeIntent()
      }
    }
    const expire = window.setInterval(() => {
      if (
        pendingRef.current &&
        Date.now() - Date.parse(pendingRef.current.capturedAt) > CAPTURE_INTENT_TTL_MS
      ) {
        pendingRef.current = null
        setStatus('The capture expired. Attach the page again.')
      }
      void consumeIntent()
    }, 5_000)
    window.addEventListener('message', message)
    chrome.storage.onChanged.addListener(storageChanged)
    chrome.tabs.onActivated.addListener(update)
    chrome.tabs.onUpdated.addListener(update)
    chrome.permissions.onAdded.addListener(update)
    chrome.permissions.onRemoved.addListener(update)
    update()
    void consumeIntent()
    return () => {
      disposed = true
      captureGenerationRef.current++
      pendingRef.current = null
      sessionRef.current = null
      window.clearInterval(expire)
      systemTheme.removeEventListener('change', applyTheme)
      window.removeEventListener('message', message)
      chrome.storage.onChanged.removeListener(storageChanged)
      chrome.tabs.onActivated.removeListener(update)
      chrome.tabs.onUpdated.removeListener(update)
      chrome.permissions.onAdded.removeListener(update)
      chrome.permissions.onRemoved.removeListener(update)
    }
  }, [])

  async function toggleSite() {
    if (!site) return
    const origins = [`${site.origin}/*`]
    try {
      const changed = site.allowed
        ? await chrome.permissions.remove({ origins })
        : await chrome.permissions.request({ origins })
      if (!changed)
        setStatus('Site access was not changed. You can still use the Sim toolbar icon.')
      else setStatus('')
    } catch {
      setStatus('Could not change site access. Use Chrome’s extension settings.')
    }
  }

  return (
    <main className='flex h-dvh flex-col bg-[var(--bg)] text-[var(--text-primary)]'>
      <div className='shrink-0 border-[var(--border)] border-b px-3 py-2'>
        <div className='flex items-center gap-2'>
          <Chip leftIcon={Globe} disabled={busy} onClick={() => void capture('page')}>
            Attach page
          </Chip>
          <Chip disabled={busy} onClick={() => void capture('selection')}>
            Selection
          </Chip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className='ml-auto'
                variant='ghost'
                size='icon'
                aria-label='Extension options'
              >
                <MoreHorizontal className='size-[14px]' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              {site ? (
                <DropdownMenuItem onSelect={() => void toggleSite()}>
                  {site.allowed ? 'Remove access to' : 'Allow access to'}{' '}
                  {new URL(site.origin).hostname}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem disabled>No site access to manage</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p
          className={status ? 'mt-2 text-[var(--text-secondary)] text-caption' : 'sr-only'}
          role='status'
        >
          {status}
        </p>
      </div>
      <iframe
        allow={`clipboard-write ${origin}`}
        ref={frameRef}
        title='Sim chat'
        src={`${origin}/extension`}
        className='min-h-0 w-full flex-1 border-0'
        referrerPolicy='no-referrer'
        sandbox='allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads'
      />
    </main>
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<SidePanel origin={SIM_ORIGIN} />)
