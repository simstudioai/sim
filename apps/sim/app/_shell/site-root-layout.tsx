import { ToastProvider } from '@sim/emcn-legacy'
import type { Viewport } from 'next'
import Script from 'next/script'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { BrandedLayout } from '@/components/branded-layout'
import { SettingsNavigationGuard } from '@/components/settings/settings-navigation-guard'
import { PasteAdmissionGuard } from '@/app/_shell/paste-admission-guard'
import { BrowserTelemetry } from '@/app/_shell/providers/browser-telemetry'
import { ToastSink } from '@/app/_shell/toast-sink'
import '@/app/_styles/globals.css'
import { SessionProvider } from '@/lib/auth/session-provider'
import { env } from '@/lib/core/config/env'
import { isHosted, isReactGrabEnabled, isReactScanEnabled } from '@/lib/core/config/env-flags'
import { publicEnvHtmlAttributes } from '@/lib/core/config/public-env'
import { AppAnalytics, AppHead } from '@/app/_shell/app-document'
import { ConsentBanner } from '@/app/_shell/consent/consent-banner'
import { DesktopUpdateGate } from '@/app/_shell/desktop-update-gate'
import { DesktopUpdateNotification } from '@/app/_shell/desktop-update-notification'
import { HydrationErrorHandler } from '@/app/_shell/hydration-error-handler'
import { QueryProvider } from '@/app/_shell/providers/query-provider'
import { ThemeProvider } from '@/app/_shell/providers/theme-provider'
import { TooltipProvider } from '@/app/_shell/providers/tooltip-provider'
import { season } from '@/app/_styles/fonts/season/season'

/** Viewport every site root layout exports; Next reads it only from the layout module. */
export const SITE_VIEWPORT: Viewport = {
  width: 'device-width',
  initialScale: 1,
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0c0c' },
  ],
}

interface SiteRootLayoutProps {
  children: React.ReactNode
}

/**
 * The `<html>` document shared by every site root layout (each top-level route
 * group outside the product). Each root layout also exports
 * `SITE_VIEWPORT` and its branded `metadata`, since Next reads those only from
 * the layout module itself.
 */
export function SiteRootLayout({ children }: SiteRootLayoutProps) {
  const application = (
    <ToastProvider>
      <ToastSink />
      <SettingsNavigationGuard />
      <DesktopUpdateNotification />
      <PasteAdmissionGuard />
      <ThemeProvider>
        <QueryProvider>
          <SessionProvider>
            <BrowserTelemetry
              disabled={env.NEXT_TELEMETRY_DISABLED === '1'}
              consentRequired={isHosted}
            />
            <TooltipProvider>
              <BrandedLayout>{children}</BrandedLayout>
            </TooltipProvider>
          </SessionProvider>
        </QueryProvider>
      </ThemeProvider>
    </ToastProvider>
  )

  return (
    <html lang='en' suppressHydrationWarning {...publicEnvHtmlAttributes()}>
      <head>
        {isReactScanEnabled && (
          <Script
            src='https://unpkg.com/react-scan/dist/auto.global.js'
            crossOrigin='anonymous'
            strategy='beforeInteractive'
          />
        )}
        {isReactGrabEnabled && (
          <Script
            src='https://unpkg.com/react-grab/dist/index.global.js'
            crossOrigin='anonymous'
            strategy='beforeInteractive'
          />
        )}
        {isReactGrabEnabled && (
          <Script
            src='https://unpkg.com/@react-grab/cursor/dist/client.global.js'
            strategy='lazyOnload'
          />
        )}
        <AppHead />
        {/*
          Standalone settings sidebar dimensions: set CSS vars before hydration to avoid layout jump.
          
          IMPORTANT: These hardcoded values must stay in sync with stores/constants.ts
          We cannot use imports here since this is a blocking script that runs before React.
        */}
        <script
          id='workspace-layout-dimensions'
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                // The desktop shell's inset title-bar lane replaces the collapsed rail.
                var collapsedSidebarWidth =
                  document.documentElement.getAttribute('data-sim-desktop-title-bar') === 'inset' ? 0 : 48;
                try {
                  var path = window.location.pathname;
                  if (path.indexOf('/account/settings') !== 0 && path.indexOf('/selfhost/settings') !== 0) {
                    return;
                  }
                } catch (e) {
                  return;
                }

                // Sidebar width. Mirror getMaxSidebarWidth() in stores/sidebar/store.ts:
                // 30% of the viewport capped at 400px, and never below the 224px
                // minimum, so a narrow window yields a width >= MIN instead of a
                // sub-minimum sliver.
                var defaultSidebarWidth = 224;
                try {
                  // Collapse comes from the cookie (independent of localStorage
                  // parsing); the persisted width is read defensively below. Match the
                  // value strictly so 'sidebar_collapsed=10' isn't read as collapsed.
                  var cookieMatch = document.cookie.match(/(?:^|;\\s*)sidebar_collapsed=([^;]*)/);
                  var hasCookie = cookieMatch !== null;
                  var collapsed = cookieMatch !== null && cookieMatch[1] === '1';

                  var state = null;
                  try {
                    var stored = localStorage.getItem('sidebar-state');
                    state = stored ? JSON.parse(stored).state : null;
                  } catch (e) {}

                  // One-time migration: seed the cookie from the legacy localStorage
                  // flag for users who collapsed before the cookie existed.
                  if (!hasCookie && state && typeof state.isCollapsed === 'boolean') {
                    collapsed = state.isCollapsed;
                    document.cookie = 'sidebar_collapsed=' + (collapsed ? '1' : '0') + '; path=/; max-age=31536000; samesite=lax';
                  }

                  // The expanded width is published unconditionally, even while
                  // collapsed, because the desktop hover-peek renders the sidebar at
                  // its restore width while --sidebar-width still reads collapsed.
                  var width = state && state.sidebarWidth;
                  var maxSidebarWidth = Math.max(224, Math.min(400, window.innerWidth * 0.3));
                  var expandedWidth =
                    typeof width === 'number' && isFinite(width)
                      ? Math.min(Math.max(width, 224), maxSidebarWidth)
                      : Math.min(defaultSidebarWidth, maxSidebarWidth);
                  document.documentElement.style.setProperty(
                    '--sidebar-expanded-width',
                    expandedWidth + 'px'
                  );
                  document.documentElement.style.setProperty(
                    '--sidebar-width',
                    (collapsed ? collapsedSidebarWidth : expandedWidth) + 'px'
                  );
                } catch (e) {
                  document.documentElement.style.setProperty('--sidebar-width', defaultSidebarWidth + 'px');
                  document.documentElement.style.setProperty('--sidebar-expanded-width', defaultSidebarWidth + 'px');
                }
              })();
            `,
          }}
        />

        {/* Basic head hints that are not covered by the Metadata API */}
        <meta name='color-scheme' content='light dark' />
        <meta name='format-detection' content='telephone=no' />
        <meta httpEquiv='x-ua-compatible' content='ie=edge' />
      </head>
      <body className={`${season.variable} font-season`} suppressHydrationWarning>
        <HydrationErrorHandler />
        <DesktopUpdateGate />
        <NuqsAdapter>
          <AppAnalytics consentBanner={<ConsentBanner />}>{application}</AppAnalytics>
        </NuqsAdapter>
      </body>
    </html>
  )
}
