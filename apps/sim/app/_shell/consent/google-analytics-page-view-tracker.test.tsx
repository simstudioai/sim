/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"https://www.sim.ai"}
 */
import { writeFileSync } from 'node:fs'
import { act } from 'react'
import { type ConsentManagerOptions, ConsentManagerProvider } from '@c15t/nextjs/headless'
import { clearConsentRuntimeCache, getOrCreateConsentRuntime } from 'c15t'
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getGlobalConsentScripts } from '@/lib/consent/scripts'
import { GoogleAnalyticsPageViewTracker } from '@/app/_shell/consent/google-analytics-page-view-tracker'

let root: Root | undefined

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  clearConsentRuntimeCache()
  vi.useRealTimers()
  window.dataLayer = []
  Reflect.deleteProperty(window, 'gtag')
  window.history.replaceState({}, '', '/')
})

describe('Google navigation measurement', () => {
  it.each([
    { initialPath: '/', navigateBeforeConsent: false, navigateBeforeReady: false },
    { initialPath: '/', navigateBeforeConsent: true, navigateBeforeReady: false },
    { initialPath: '/', navigateBeforeConsent: true, navigateBeforeReady: true },
    {
      initialPath: '/workspace/workspace-id',
      navigateBeforeConsent: false,
      navigateBeforeReady: false,
    },
  ])(
    'preserves consent and navigation semantics ($initialPath, $navigateBeforeConsent, $navigateBeforeReady)',
    ({ initialPath, navigateBeforeConsent, navigateBeforeReady }) => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
      vi.stubGlobal('matchMedia', (media: string) => ({
        matches: false,
        media,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      }))
      vi.useFakeTimers()
      const initialUrl = `${initialPath}?utm_source=proof`
      window.history.replaceState({}, '', initialUrl)
      const google = getGlobalConsentScripts().find((script) => script.id === 'gtag')
      const deniedConsent = {
        necessary: true,
        functionality: false,
        experience: false,
        measurement: false,
        marketing: false,
      }
      google?.onBeforeLoad?.({
        id: 'gtag',
        elementId: 'gtag',
        hasConsent: false,
        consents: deniedConsent,
      })

      const options = {
        mode: 'offline',
        colorScheme: 'light',
        consentCategories: ['necessary', 'measurement', 'marketing'],
        store: { enabled: false },
      } satisfies ConsentManagerOptions
      const { consentStore } = getOrCreateConsentRuntime(options)
      consentStore.setState({
        hasFetchedBanner: true,
        loadedScripts: { gtag: true },
        consents: deniedConsent,
        policyCategories: ['necessary', 'measurement', 'marketing'],
      })
      const container = document.createElement('div')
      root = createRoot(container)
      const render = (path: string) => {
        window.history.pushState({}, '', path)
        act(() => {
          root?.render(
            <ConsentManagerProvider options={options}>
              <PathnameContext.Provider value={new URL(window.location.href).pathname}>
                <GoogleAnalyticsPageViewTracker />
              </PathnameContext.Provider>
            </ConsentManagerProvider>
          )
        })
      }
      const pageViews = () =>
        window.dataLayer.filter(
          (row) => Array.isArray(row) && row[0] === 'event' && row[1] === 'page_view'
        )
      const latestContext = () =>
        window.dataLayer.filter((row) => Array.isArray(row) && row[0] === 'set').at(-1)

      render(navigateBeforeReady ? '/pricing?secret=private' : initialUrl)
      if (navigateBeforeConsent) {
        render('/pricing?secret=private')
        expect(latestContext()).toEqual([
          'set',
          expect.objectContaining({
            page_location: 'https://www.sim.ai/pricing',
            page_referrer: 'https://www.sim.ai/?utm_source=proof',
          }),
        ])
      }
      expect(pageViews()).toHaveLength(0)

      act(() => {
        consentStore.setState({ consents: { ...deniedConsent, measurement: true } })
      })
      expect(pageViews()).toHaveLength(navigateBeforeConsent ? 1 : 0)
      render('/demo')
      render('/demo')
      expect(pageViews()).toHaveLength(navigateBeforeConsent ? 2 : 1)

      act(() => {
        consentStore.setState({ consents: deniedConsent })
      })
      render('/workspace/workspace-id/files/file-id')
      expect(pageViews()).toHaveLength(navigateBeforeConsent ? 2 : 1)
      expect(latestContext()).toEqual([
        'set',
        expect.objectContaining({
          page_location: 'https://www.sim.ai/workspace',
          page_referrer: 'https://www.sim.ai/demo',
          page_title: 'Sim',
        }),
      ])

      const reportPath = process.env.GAUGE_TRACKER_REPORT_PATH
      if (reportPath && navigateBeforeConsent && !navigateBeforeReady) {
        writeFileSync(
          reportPath,
          JSON.stringify(
            {
              status: 'passed',
              checks: [
                'denied navigation context',
                'consent emission gate',
                'delayed consent after navigation',
                'navigation deduplication',
                'withdrawn consent context',
              ],
              commands: window.dataLayer,
              limitation:
                'Real React, Next router context and c15t store; Google SDK collection is not exercised.',
            },
            null,
            2
          )
        )
      }
    }
  )
})
