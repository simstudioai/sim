'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  RECENT_PAGES_LIMIT,
  type RecentPage,
  recentPagesSchema,
  recentPageUrl,
  recentsStatusSchema,
} from '@sim/browser-extension-protocol'
import { sleep } from '@sim/utils/helpers'

/** A sleeping extension worker wakes well inside this; beyond it Home keeps what it has. */
const ANSWER_TIMEOUT_MS = 1_500
const ON_HINT_KEY = 'sim:recent-pages-on'
const OFFER_DISMISSED_KEY = 'sim:recent-pages-offer-dismissed'
const ENVELOPE = { channel: 'sim-extension', version: 1 } as const

interface ExtensionRuntime {
  sendMessage: (id: string, message: unknown, respond: (response: unknown) => void) => void
  lastError?: unknown
}

export type BrowserRecents =
  | { kind: 'unavailable' }
  | { kind: 'pending' }
  | { kind: 'offer'; open: () => void; dismiss: () => void }
  | { kind: 'ready'; pages: readonly RecentPage[] }

type Reading =
  | { kind: 'off' }
  | { kind: 'offer'; id: string }
  | { kind: 'ready'; pages: RecentPage[] }

/** Chrome exposes this to a page only when an installed extension's manifest admits its origin. */
function runtime(): ExtensionRuntime | null {
  const chromeGlobal = (globalThis as { chrome?: { runtime?: Partial<ExtensionRuntime> } }).chrome
  return chromeGlobal?.runtime?.sendMessage ? (chromeGlobal.runtime as ExtensionRuntime) : null
}

function ask(id: string, message: object): Promise<unknown> {
  const extension = runtime()
  if (!extension) return Promise.resolve(undefined)
  return Promise.race([
    new Promise<unknown>((settle) => {
      try {
        extension.sendMessage(id, { ...ENVELOPE, ...message }, (response) => {
          // Reading it is what tells Chrome the missing extension was expected.
          void extension.lastError
          settle(response)
        })
      } catch {
        settle(undefined)
      }
    }),
    sleep(ANSWER_TIMEOUT_MS).then(() => undefined),
  ])
}

function readFlag(storage: 'sessionStorage' | 'localStorage', key: string): boolean {
  try {
    return window[storage].getItem(key) === '1'
  } catch {
    return false
  }
}

function writeFlag(storage: 'sessionStorage' | 'localStorage', key: string, on: boolean) {
  try {
    if (on) window[storage].setItem(key, '1')
    else window[storage].removeItem(key)
  } catch {
    // A blocked store only costs the hint.
  }
}

async function readExtension(ids: readonly string[]): Promise<Reading> {
  const answers = await Promise.all(
    ids.map(async (id) => ({
      id,
      status: recentsStatusSchema.safeParse(await ask(id, { type: 'recents-status' })),
    }))
  )
  const installed = answers.find((answer) => answer.status.success)
  if (!installed?.status.success) return { kind: 'off' }
  const { permission, enabled } = installed.status.data
  if (permission !== 'granted' || !enabled) return { kind: 'offer', id: installed.id }
  const read = recentPagesSchema.safeParse(
    await ask(installed.id, { type: 'recent-pages', limit: RECENT_PAGES_LIMIT })
  )
  if (!read.success) return { kind: 'off' }
  const pages = read.data.pages.filter(
    (page) => recentPageUrl(page.url, window.location.origin) === page.url
  )
  return pages.length > 0 ? { kind: 'ready', pages } : { kind: 'off' }
}

/**
 * The pages this person recently visited, from Sim's browser extension when they have installed it
 * and turned this on. Addresses stay in this component's memory, outside every shared cache, and
 * never travel to Sim's servers; only a yes-or-no hint is remembered, so someone who opted in does
 * not see their row swap and nobody else waits.
 */
export function useBrowserRecents(extensionIds: readonly string[]): BrowserRecents {
  const [reading, setReading] = useState<Reading | null>(null)
  const [hinted, setHinted] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const inFlight = useRef(false)
  const ids = extensionIds.join(',')

  const refresh = useCallback(async () => {
    const configured = ids ? ids.split(',') : []
    if (inFlight.current || !runtime()) return
    inFlight.current = true
    try {
      const next = await readExtension(configured)
      writeFlag('sessionStorage', ON_HINT_KEY, next.kind === 'ready')
      setReading(next)
    } finally {
      inFlight.current = false
      setHinted(false)
    }
  }, [ids])

  // Before paint on a client navigation, so someone who opted in never sees the other row first.
  useLayoutEffect(() => {
    setDismissed(readFlag('localStorage', OFFER_DISMISSED_KEY))
    if (runtime() && ids) setHinted(readFlag('sessionStorage', ON_HINT_KEY))
  }, [ids])

  useEffect(() => {
    void refresh()
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [ids, refresh])

  if (reading?.kind === 'ready') return { kind: 'ready', pages: reading.pages }
  if (hinted) return { kind: 'pending' }
  if (reading?.kind === 'offer' && !dismissed) {
    const { id } = reading
    return {
      kind: 'offer',
      open: () => void ask(id, { type: 'open-recents-setup' }),
      dismiss: () => {
        writeFlag('localStorage', OFFER_DISMISSED_KEY, true)
        setDismissed(true)
      },
    }
  }
  return { kind: 'unavailable' }
}
