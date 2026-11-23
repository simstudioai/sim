import { useEffect, useRef, useState } from 'react'
import {
  appToExtensionMessageSchema,
  type ExtensionToAppMessage,
  type PageSnapshot,
} from '@sim/browser-extension-protocol'
import { createRoot } from 'react-dom/client'
import {
  captureActivePage,
  captureErrorMessage,
  PAGE_CHANGED_MESSAGE,
  PageCaptureError,
  SiteAccessRequiredError,
  UnreadableSelectionError,
} from '@/capture'
import {
  CAPTURE_INTENT_KEY,
  CAPTURE_INTENT_TTL_MS,
  REFERENCE_PAGE_KEY,
  SIM_ORIGIN,
  VISIT_SHORT_HOSTS_MESSAGE,
} from '@/config'
import { type CaptureIntent, captureIntentSchema } from '@/intent'
import { createReferenceCapture, PAGE_ATTACHMENT_PENDING_MESSAGE } from '@/reference'
import { PageAccessButton, SiteAccessDialog } from '@/site-access'
import '@/shell.css'

const PAGE_ATTACHMENT_EXPIRED_MESSAGE = 'The page attachment expired. Attach it again.'
const BLOCKED_SELECTION =
  'Select readable text again, attach the page explicitly, or turn off Reference current page.'
const KEYBOARD_FOCUS_HINT = navigator.platform.startsWith('Mac')
  ? 'Click the message field, or press ⌘⌥↑ to move focus.'
  : 'Click the message field, or press F6 to move focus.'

interface SidePanelProps {
  origin: string
}

function SidePanel({ origin }: SidePanelProps) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const pendingRef = useRef<PageSnapshot | null>(null)
  const focusRequested = useRef(false)
  const unreadableSelection = useRef<{ tabId: number; windowId: number } | null>(null)
  const sessionRef = useRef<string | null>(null)
  const connectedRef = useRef(false)
  const deliveredRef = useRef<string | null>(null)
  const captureGenerationRef = useRef(0)
  const intentCutoffRef = useRef(0)
  const busyRef = useRef(false)
  const [accessOpen, setAccessOpen] = useState(false)
  const [status, setStatus] = useState<string | { message: string }>('')
  const referenceRef = useRef<ReturnType<typeof createReferenceCapture> | null>(null)

  useEffect(() => {
    if (!(status instanceof SiteAccessRequiredError)) return
    const navigated = (tabId: number, change: chrome.tabs.OnUpdatedInfo) => {
      if (tabId === status.tabId && (change.status === 'loading' || change.url !== undefined)) {
        setStatus((current) => (current === status ? PAGE_CHANGED_MESSAGE : current))
      }
    }
    const activated = (tab: chrome.tabs.OnActivatedInfo) => {
      if (tab.windowId === status.windowId && tab.tabId !== status.tabId)
        setStatus((current) => (current === status ? '' : current))
    }
    chrome.tabs.onActivated.addListener(activated)
    chrome.tabs.onUpdated.addListener(navigated)
    return () => {
      chrome.tabs.onActivated.removeListener(activated)
      chrome.tabs.onUpdated.removeListener(navigated)
    }
  }, [status])

  function deliver() {
    const snapshot = pendingRef.current
    const sessionId = sessionRef.current
    if (!connectedRef.current || !snapshot || !sessionId || deliveredRef.current === snapshot.id)
      return
    if (Date.now() - Date.parse(snapshot.capturedAt) > CAPTURE_INTENT_TTL_MS) {
      pendingRef.current = null
      focusRequested.current = false
      setStatus(PAGE_ATTACHMENT_EXPIRED_MESSAGE)
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

  function deliverFocus() {
    if (!focusRequested.current || !connectedRef.current || !sessionRef.current) return
    focusRequested.current = false
    if (document.querySelector('dialog[open]')) return
    const message: ExtensionToAppMessage = {
      channel: 'sim-extension',
      version: 1,
      type: 'focus-composer',
      sessionId: sessionRef.current,
    }
    frameRef.current?.contentWindow?.postMessage(message, SIM_ORIGIN)
    if (!document.hasFocus()) setStatus(KEYBOARD_FOCUS_HINT)
  }

  function invalidateSession() {
    unreadableSelection.current = null
    focusRequested.current = false
    referenceRef.current?.reset()
    setStatus((status) => (typeof status === 'string' ? status : ''))
    intentCutoffRef.current = Date.now()
    setAccessOpen(false)
    if (pendingRef.current || busyRef.current) setStatus('The chat changed. Attach the page again.')
    captureGenerationRef.current++
    pendingRef.current = null
    deliveredRef.current = null
    sessionRef.current = null
    connectedRef.current = false
    busyRef.current = false
  }

  async function capture(
    kind: 'page' | 'selection',
    expected?: {
      tabId: number
      documentId: string
      urlDigest: string
      windowId: number
      focusComposer?: boolean
    }
  ) {
    if (referenceRef.current?.busy()) {
      setStatus(PAGE_ATTACHMENT_PENDING_MESSAGE)
      return
    }
    if (busyRef.current) return
    if (pendingRef.current) {
      setStatus(PAGE_ATTACHMENT_PENDING_MESSAGE)
      return
    }
    busyRef.current = true
    const generation = ++captureGenerationRef.current
    setStatus('Reading the page…')
    try {
      const snapshot = await captureActivePage(kind, expected)
      if (generation !== captureGenerationRef.current) return
      focusRequested.current = expected?.focusComposer === true
      unreadableSelection.current = null
      pendingRef.current = snapshot
      setStatus('Attaching the page…')
      deliver()
    } catch (error) {
      if (generation !== captureGenerationRef.current) return
      if (error instanceof UnreadableSelectionError) unreadableSelection.current = error
      setStatus(error instanceof PageCaptureError ? error : captureErrorMessage(error))
    } finally {
      if (generation === captureGenerationRef.current) {
        busyRef.current = false
      }
    }
  }

  useEffect(() => {
    let disposed = false
    const currentWindow = chrome.windows.getCurrent()
    const manualIntents = new Set<string>()
    let processingManual = false
    const reference = createReferenceCapture({
      session: () => sessionRef.current,
      post: (message) => frameRef.current?.contentWindow?.postMessage(message, SIM_ORIGIN),
      manualCaptureError: () => {
        if (busyRef.current || pendingRef.current || processingManual || manualIntents.size)
          return {
            message: PAGE_ATTACHMENT_PENDING_MESSAGE,
          }
        if (unreadableSelection.current) return { message: BLOCKED_SELECTION, reason: 'selection' }
      },
      showStatus: setStatus,
      clearAccessStatus: () => setStatus((status) => (typeof status === 'string' ? status : '')),
    })
    referenceRef.current = reference
    let appTheme: 'light' | 'dark' | undefined
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const theme = appTheme ?? (systemTheme.matches ? 'dark' : 'light')
      document.documentElement.classList.toggle('dark', theme === 'dark')
      document.documentElement.classList.toggle('light', theme === 'light')
    }
    applyTheme()
    systemTheme.addEventListener('change', applyTheme)
    const clearFocusHint = () => {
      if (document.hasFocus())
        setStatus((current) => (current === KEYBOARD_FOCUS_HINT ? '' : current))
    }
    const clearBlockedSelection = () => {
      unreadableSelection.current = null
      setStatus((current) =>
        current instanceof UnreadableSelectionError || current === BLOCKED_SELECTION ? '' : current
      )
    }
    const activated = ({ tabId, windowId }: chrome.tabs.OnActivatedInfo) => {
      const blocked = unreadableSelection.current
      if (blocked?.windowId === windowId && blocked.tabId !== tabId) clearBlockedSelection()
    }
    const navigated = (tabId: number, change: chrome.tabs.OnUpdatedInfo) => {
      if (
        unreadableSelection.current?.tabId === tabId &&
        (change.status === 'loading' || change.url)
      )
        clearBlockedSelection()
    }
    let consumingIntent = false
    const currentIntent = (intent: CaptureIntent, windowId: number | undefined) => {
      const age = Date.now() - intent.createdAt
      return (
        intent.windowId === windowId &&
        intent.createdAt > intentCutoffRef.current &&
        age >= 0 &&
        age <= CAPTURE_INTENT_TTL_MS
      )
    }
    const consumeIntent = async () => {
      if (disposed || consumingIntent || reference.busy() || busyRef.current || pendingRef.current)
        return
      consumingIntent = true
      try {
        const window = await currentWindow
        if (window.id === undefined) return
        const stored = await chrome.storage.session.get(null)
        if (disposed || reference.busy() || busyRef.current || pendingRef.current) return
        const keys = Object.keys(stored).filter((key) =>
          key.startsWith(`${CAPTURE_INTENT_KEY}:${window.id}:`)
        )
        const intents = keys
          .flatMap((key) => {
            const intent = captureIntentSchema.safeParse(stored[key])
            return intent.success && intent.data.windowId === window.id ? [intent.data] : []
          })
          .sort((left, right) => right.createdAt - left.createdAt)
        processingManual = intents.some(
          (intent) => intent.kind !== 'focus' && currentIntent(intent, window.id)
        )
        if (keys.length) await chrome.storage.session.remove(keys)
        for (const key of keys) manualIntents.delete(key)
        const intent = intents[0]
        if (intent && intent.createdAt <= intentCutoffRef.current) {
          if (!disposed) setStatus('The chat changed. Attach the page again.')
          return
        }
        if (disposed || !intent) return
        if (!currentIntent(intent, window.id)) {
          setStatus(PAGE_ATTACHMENT_EXPIRED_MESSAGE)
          return
        }
        if (intent.kind === 'focus') {
          const [tab] = await chrome.tabs.query({ active: true, windowId: intent.windowId })
          if (!disposed && tab?.id === intent.tabId && intent.createdAt > intentCutoffRef.current) {
            focusRequested.current = true
            deliverFocus()
          }
        } else await capture(intent.kind, intent)
      } catch {
        if (!disposed) setStatus('Could not attach the page. Try again.')
      } finally {
        processingManual = false
        consumingIntent = false
      }
    }
    const storageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      if (area === 'local' && REFERENCE_PAGE_KEY in changes) {
        if (changes[REFERENCE_PAGE_KEY].newValue !== true) {
          clearBlockedSelection()
        }
        reference.preferenceChanged(changes[REFERENCE_PAGE_KEY].newValue)
      }
      if (area === 'session')
        void currentWindow.then((window) => {
          if (disposed) return
          for (const [key, change] of Object.entries(changes)) {
            if (!key.startsWith(`${CAPTURE_INTENT_KEY}:${window.id}:`)) continue
            const intent = captureIntentSchema.safeParse(change.newValue)
            if (
              intent.success &&
              intent.data.kind !== 'focus' &&
              currentIntent(intent.data, window.id)
            ) {
              manualIntents.add(key)
              reference.manualRequested()
            } else manualIntents.delete(key)
          }
          if (Object.values(changes).some((change) => change.newValue)) void consumeIntent()
        })
    }
    let handshake = 0
    const connect = async (sessionId: string) => {
      const current = ++handshake
      if (sessionRef.current && sessionRef.current !== sessionId) invalidateSession()
      sessionRef.current = sessionId
      connectedRef.current = false
      if (!(await reference.refreshPreference(sessionId))) return
      if (disposed || handshake !== current || sessionRef.current !== sessionId) return
      connectedRef.current = true
      const connected: ExtensionToAppMessage = {
        channel: 'sim-extension',
        version: 1,
        type: 'connected',
        sessionId,
      }
      frameRef.current?.contentWindow?.postMessage(connected, SIM_ORIGIN)
      deliver()
      if (!pendingRef.current) deliverFocus()
    }
    const message = (event: MessageEvent<unknown>) => {
      if (event.origin !== SIM_ORIGIN || event.source !== frameRef.current?.contentWindow) return
      const parsed = appToExtensionMessageSchema.safeParse(event.data)
      if (!parsed.success) return
      if (parsed.data.type === 'theme') {
        appTheme = parsed.data.theme
        applyTheme()
      } else if (parsed.data.type === 'signed-in') {
        void chrome.runtime.sendMessage(VISIT_SHORT_HOSTS_MESSAGE).catch(() => undefined)
      } else if (parsed.data.type === 'ready') {
        void connect(parsed.data.sessionId)
      } else if (parsed.data.sessionId !== sessionRef.current) {
        return
      } else if (parsed.data.type === 'unavailable') {
        invalidateSession()
      } else if (!connectedRef.current) {
        return
      } else if (parsed.data.type === 'composer-focused') {
        setStatus((current) => (current === KEYBOARD_FOCUS_HINT ? '' : current))
      } else if (parsed.data.type === 'set-reference-preference') {
        void reference.setPreference(parsed.data.enabled)
      } else if (parsed.data.type === 'capture-for-send') {
        void reference.capture(parsed.data.sessionId, parsed.data.requestId)
      } else if (parsed.data.type === 'action') {
        if (!navigator.userActivation.isActive) return
        if (parsed.data.action === 'site-access') setAccessOpen(true)
        else if (parsed.data.action === 'microphone-settings')
          void chrome.tabs.create({ url: 'chrome://settings/content/microphone' })
        else void capture(parsed.data.action === 'capture-page' ? 'page' : 'selection')
      } else if (pendingRef.current?.id === parsed.data.snapshotId) {
        pendingRef.current = null
        setStatus('')
        deliverFocus()
        void consumeIntent()
      }
    }
    const expire = window.setInterval(() => {
      if (
        pendingRef.current &&
        Date.now() - Date.parse(pendingRef.current.capturedAt) > CAPTURE_INTENT_TTL_MS
      ) {
        pendingRef.current = null
        focusRequested.current = false
        setStatus(PAGE_ATTACHMENT_EXPIRED_MESSAGE)
      }
      void consumeIntent()
    }, 5_000)
    window.addEventListener('focus', clearFocusHint, true)
    chrome.tabs.onActivated.addListener(activated)
    chrome.tabs.onUpdated.addListener(navigated)
    window.addEventListener('message', message)
    chrome.storage.onChanged.addListener(storageChanged)
    void consumeIntent()
    return () => {
      disposed = true
      captureGenerationRef.current++
      pendingRef.current = null
      sessionRef.current = null
      connectedRef.current = false
      window.clearInterval(expire)
      systemTheme.removeEventListener('change', applyTheme)
      window.removeEventListener('focus', clearFocusHint, true)
      chrome.tabs.onActivated.removeListener(activated)
      chrome.tabs.onUpdated.removeListener(navigated)
      window.removeEventListener('message', message)
      chrome.storage.onChanged.removeListener(storageChanged)
      reference.reset()
      referenceRef.current = null
    }
  }, [])

  return (
    <main className='flex h-dvh flex-col bg-[var(--bg)] text-[var(--text-primary)]'>
      <div
        className={
          status ? 'shrink-0 px-3 py-2 text-[var(--text-secondary)] text-caption' : 'sr-only'
        }
        role='status'
      >
        {status instanceof SiteAccessRequiredError ? (
          <PageAccessButton
            onAccessGranted={() =>
              setStatus((current) => (current instanceof SiteAccessRequiredError ? '' : current))
            }
          />
        ) : typeof status === 'string' ? (
          status
        ) : (
          status.message
        )}
      </div>
      <iframe
        allow={`clipboard-write ${origin}; microphone ${origin}`}
        ref={frameRef}
        title='Sim chat'
        src={`${origin}/extension`}
        className='min-h-0 w-full flex-1 border-0'
        referrerPolicy='no-referrer'
        sandbox='allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads'
      />
      {accessOpen && (
        <SiteAccessDialog
          onClose={() => setAccessOpen(false)}
          onAccessGranted={() => {
            setAccessOpen(false)
            setStatus((current) => (current instanceof SiteAccessRequiredError ? '' : current))
          }}
        />
      )}
    </main>
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<SidePanel origin={SIM_ORIGIN} />)
