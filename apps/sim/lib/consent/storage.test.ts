/**
 * @vitest-environment jsdom
 */
import {
  createConsentManagerStore,
  deleteConsentFromStorage,
  generateSubjectId,
  getCookie,
  OfflineClient,
  setCookie,
} from 'c15t'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONSENT_STORAGE_CONFIG, prepareConsentStorage } from '@/lib/consent/storage'

const NOW = Date.UTC(2026, 8, 8)
const DAY_MS = 24 * 60 * 60 * 1000
const onTrackingLoad = vi.fn()
let store: ReturnType<typeof createConsentManagerStore> | undefined

function savedConsent(time: unknown, granted = true, materialPolicyFingerprint?: string) {
  return {
    consents: { necessary: true, measurement: granted, marketing: granted },
    consentInfo: { time, subjectId: generateSubjectId(), materialPolicyFingerprint },
  }
}

async function initializeConsentStore() {
  store = createConsentManagerStore(new OfflineClient(CONSENT_STORAGE_CONFIG), {
    storageConfig: CONSENT_STORAGE_CONFIG,
    initialConsentCategories: ['necessary', 'measurement', 'marketing'],
    iframeBlockerConfig: { disableAutomaticBlocking: true },
    scripts: [
      {
        id: 'consent-expiry-test-tracker',
        category: 'measurement',
        callbackOnly: true,
        onLoad: onTrackingLoad,
      },
    ],
  })
  await store.getState().initConsentManager()
  return store.getState()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  window.localStorage.clear()
  deleteConsentFromStorage()
  onTrackingLoad.mockClear()
})

afterEach(() => {
  store?.getState().resetConsents()
  store?.getState().updateScripts()
  store = undefined
  deleteConsentFromStorage()
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('prepareConsentStorage', () => {
  it('prevents the SDK from restoring a 400-day-old grant or starting tracking', async () => {
    window.localStorage.setItem('c15t', JSON.stringify(savedConsent(NOW - 400 * DAY_MS)))

    prepareConsentStorage()

    expect(window.localStorage.getItem('c15t')).toBeNull()
    expect(getCookie('c15t')).toBeNull()

    const state = await initializeConsentStore()
    expect(state.hasFetchedBanner).toBe(true)
    expect(state.activeUI).toBe('banner')
    expect(state.has('measurement')).toBe(false)
    expect(state.has('marketing')).toBe(false)
    expect(onTrackingLoad).not.toHaveBeenCalled()
  })

  it('expires the authoritative cookie and its localStorage fallback together', async () => {
    window.localStorage.setItem('c15t', JSON.stringify(savedConsent(NOW - DAY_MS)))
    setCookie('c15t', savedConsent(NOW - 365 * DAY_MS))

    prepareConsentStorage()

    expect(getCookie('c15t')).toBeNull()
    expect(window.localStorage.getItem('c15t')).toBeNull()
    expect((await initializeConsentStore()).has('measurement')).toBe(false)
    expect(onTrackingLoad).not.toHaveBeenCalled()
  })

  it('preserves a fresh grant and its original consent timestamp', async () => {
    const time = NOW - 364 * DAY_MS
    window.localStorage.setItem('c15t', JSON.stringify(savedConsent(time)))

    prepareConsentStorage()

    const state = await initializeConsentStore()
    expect(state.consentInfo?.time).toBe(time)
    expect(state.activeUI).toBe('none')
    expect(state.has('measurement')).toBe(true)
    expect(onTrackingLoad).toHaveBeenCalled()
  })

  it('preserves a fresh rejection without showing another banner', async () => {
    setCookie('c15t', savedConsent(NOW - DAY_MS, false))

    prepareConsentStorage()

    const state = await initializeConsentStore()
    expect(state.activeUI).toBe('none')
    expect(state.has('measurement')).toBe(false)
    expect(state.has('marketing')).toBe(false)
    expect(onTrackingLoad).not.toHaveBeenCalled()
  })

  it('still lets the SDK request consent after a material policy change', async () => {
    window.localStorage.setItem(
      'c15t',
      JSON.stringify(savedConsent(NOW - DAY_MS, true, 'previous-policy'))
    )

    prepareConsentStorage()

    const state = await initializeConsentStore()
    expect(state.activeUI).toBe('banner')
    expect(state.has('measurement')).toBe(false)
    expect(onTrackingLoad).not.toHaveBeenCalled()
  })

  it.each([undefined, null, 'yesterday', 0, NOW + DAY_MS])(
    'discards consent with invalid or future timestamp %s',
    async (time) => {
      window.localStorage.setItem('c15t', JSON.stringify(savedConsent(time)))

      prepareConsentStorage()

      expect((await initializeConsentStore()).has('measurement')).toBe(false)
      expect(onTrackingLoad).not.toHaveBeenCalled()
    }
  )

  it('does not let a deferred save resurrect expired consent', async () => {
    const consent = savedConsent(NOW - 400 * DAY_MS)
    window.localStorage.setItem('c15t', JSON.stringify(consent))
    window.localStorage.setItem(
      'c15t:pending-consent-sync',
      JSON.stringify({
        preferences: consent.consents,
        subjectId: consent.consentInfo.subjectId,
        givenAt: new Date(NOW - 400 * DAY_MS).toISOString(),
        domain: window.location.hostname,
      })
    )

    prepareConsentStorage()

    expect(window.localStorage.getItem('c15t:pending-consent-sync')).toBeNull()
    expect((await initializeConsentStore()).has('measurement')).toBe(false)
    expect(getCookie('c15t')).toBeNull()
    expect(onTrackingLoad).not.toHaveBeenCalled()
  })

  it('tolerates inaccessible storage and removes an expired cookie', () => {
    setCookie('c15t', savedConsent(NOW - 400 * DAY_MS))
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError')
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => prepareConsentStorage()).not.toThrow()
    expect(getCookie('c15t')).toBeNull()
  })
})
