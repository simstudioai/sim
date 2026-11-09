import type { ReactNode } from 'react'
import { isHosted } from '@/lib/core/config/env-flags'
import { ConsentProvider } from '@/app/_shell/consent/consent-provider'
import { PostHogProvider } from '@/app/_shell/providers/posthog-provider'
import { PublicEnvScript, RuntimePublicEnvScript } from '@/app/_shell/public-env-script'
import { generateThemeCSS } from '@/ee/whitelabeling'

/**
 * The macOS desktop shell overlays native traffic lights on the window. Marking the document
 * before first paint lets every surface reserve its inset title-bar lane without a
 * post-hydration layout shift.
 */
const DESKTOP_TITLE_BAR_SCRIPT = `(function () {
  try {
    if (window.simDesktop && /Mac/i.test(navigator.userAgent)) {
      document.documentElement.setAttribute('data-sim-desktop-title-bar', 'inset');
    }
  } catch (e) {}
})();`

/**
 * The `<head>` every root layout shares: the desktop title-bar mark, the whitelabel theme
 * override, and the public environment transport.
 */
export function AppHead() {
  const themeCSS = generateThemeCSS()
  return (
    <>
      <script
        id='desktop-title-bar'
        dangerouslySetInnerHTML={{ __html: DESKTOP_TITLE_BAR_SCRIPT }}
      />
      {themeCSS && <style id='theme-override' dangerouslySetInnerHTML={{ __html: themeCSS }} />}
      {isHosted ? <PublicEnvScript /> : <RuntimePublicEnvScript />}
    </>
  )
}

/** Product analytics under the consent lifecycle hosted Sim requires, shared by every root. */
export function AppAnalytics({ children }: { children: ReactNode }) {
  const analytics = <PostHogProvider consentRequired={isHosted}>{children}</PostHogProvider>
  return isHosted ? <ConsentProvider>{analytics}</ConsentProvider> : analytics
}
