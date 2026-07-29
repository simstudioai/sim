import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { PublicEnvScript as RuntimePublicEnvScript } from 'next-runtime-env'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { BrandedLayout } from '@/components/branded-layout'
import { PostHogProvider } from '@/app/_shell/providers/posthog-provider'
import { generateBrandedMetadata, generateThemeCSS } from '@/ee/whitelabeling'
import '@/app/_styles/globals.css'
import { isHosted, isReactGrabEnabled, isReactScanEnabled } from '@/lib/core/config/env-flags'
import { DesktopUpdateGate } from '@/app/_shell/desktop-update-gate'
import { HydrationErrorHandler } from '@/app/_shell/hydration-error-handler'
import { QueryProvider } from '@/app/_shell/providers/query-provider'
import { SessionProvider } from '@/app/_shell/providers/session-provider'
import { ThemeProvider } from '@/app/_shell/providers/theme-provider'
import { TooltipProvider } from '@/app/_shell/providers/tooltip-provider'
import { PublicEnvScript } from '@/app/_shell/public-env-script'
import { season } from '@/app/_styles/fonts/season/season'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0c0c' },
  ],
}

export const metadata: Metadata = generateBrandedMetadata()

const GTM_ID = 'GTM-T7PHSRX5' as const
const GA_ID = 'G-DR7YBE70VS' as const

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const themeCSS = generateThemeCSS()

  return (
    <html lang='en' suppressHydrationWarning>
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
        {/* 
          Workspace layout dimensions: set CSS vars before hydration to avoid layout jump.
          
          IMPORTANT: These hardcoded values must stay in sync with stores/constants.ts
          We cannot use imports here since this is a blocking script that runs before React.
        */}
        <script
          id='workspace-layout-dimensions'
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                // The macOS desktop shell overlays native traffic lights on the
                // workspace. Mark it before first paint so the sidebar reserves
                // its inset title-bar lane without a post-hydration layout shift.
                var collapsedSidebarWidth = 51;
                try {
                  if (window.simDesktop && /Mac/i.test(navigator.userAgent)) {
                    document.documentElement.setAttribute('data-sim-desktop-title-bar', 'inset');
                    collapsedSidebarWidth = 0;
                  }
                } catch (e) {}

                try {
                  var path = window.location.pathname;
                  if (path.indexOf('/workspace/') === -1) {
                    return;
                  }
                } catch (e) {
                  return;
                }

                // Sidebar width. Mirror clampSidebarWidth() in stores/sidebar/store.ts:
                // the upper bound can never fall below the 248px minimum, so a narrow
                // window yields a width >= MIN instead of a sub-minimum sliver.
                var defaultSidebarWidth = 248;
                try {
                  // Collapse comes from the cookie (independent of localStorage
                  // parsing); the persisted width is read defensively below. Match the
                  // value strictly so 'sidebar_collapsed=10' isn't read as collapsed.
                  var cookieMatch = document.cookie.match(/(?:^|;\s*)sidebar_collapsed=([^;]*)/);
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

                  if (collapsed) {
                    document.documentElement.style.setProperty(
                      '--sidebar-width',
                      collapsedSidebarWidth + 'px'
                    );
                  } else {
                    var width = state && state.sidebarWidth;
                    var maxSidebarWidth = Math.max(248, window.innerWidth * 0.3);
                    var finalWidth =
                      typeof width === 'number' && isFinite(width)
                        ? Math.min(Math.max(width, 248), maxSidebarWidth)
                        : defaultSidebarWidth;
                    document.documentElement.style.setProperty('--sidebar-width', finalWidth + 'px');
                  }
                } catch (e) {
                  document.documentElement.style.setProperty('--sidebar-width', defaultSidebarWidth + 'px');
                }

                // Panel width and active tab
                try {
                  var panelStored = localStorage.getItem('panel-state');
                  if (panelStored) {
                    var panelParsed = JSON.parse(panelStored);
                    var panelState = panelParsed && panelParsed.state;
                    var panelWidth = panelState && panelState.panelWidth;
                    var maxPanelWidth = window.innerWidth * 0.4;

                    if (panelWidth >= 290 && panelWidth <= maxPanelWidth) {
                      document.documentElement.style.setProperty('--panel-width', panelWidth + 'px');
                    } else if (panelWidth > maxPanelWidth) {
                      document.documentElement.style.setProperty('--panel-width', maxPanelWidth + 'px');
                    }

                    var activeTab = panelState && panelState.activeTab;
                    if (activeTab) {
                      document.documentElement.setAttribute('data-panel-active-tab', activeTab);
                    }
                  }
                } catch (e) {
                  // Fallback handled by CSS defaults
                }

                // Editor connections height
                try {
                  var editorStored = localStorage.getItem('panel-editor-state');
                  if (editorStored) {
                    var editorParsed = JSON.parse(editorStored);
                    var editorState = editorParsed && editorParsed.state;
                    var connectionsHeight = editorState && editorState.connectionsHeight;
                    if (connectionsHeight !== undefined && connectionsHeight >= 30 && connectionsHeight <= 300) {
                      document.documentElement.style.setProperty(
                        '--editor-connections-height',
                        connectionsHeight + 'px'
                      );
                    }
                  }
                } catch (e) {
                  // Fallback handled by CSS defaults
                }

                // Terminal height
                try {
                  var terminalStored = localStorage.getItem('terminal-state');
                  if (terminalStored) {
                    var terminalParsed = JSON.parse(terminalStored);
                    var terminalState = terminalParsed && terminalParsed.state;
                    var terminalHeight = terminalState && terminalState.terminalHeight;
                    var maxTerminalHeight = window.innerHeight * 0.7;

                    if (terminalHeight >= 30 && terminalHeight <= maxTerminalHeight) {
                      document.documentElement.style.setProperty('--terminal-height', terminalHeight + 'px');
                    } else if (terminalHeight > maxTerminalHeight) {
                      document.documentElement.style.setProperty('--terminal-height', maxTerminalHeight + 'px');
                    }
                  }
                } catch (e) {
                  // Fallback handled by CSS defaults
                }
              })();
            `,
          }}
        />

        {/* Theme CSS Override */}
        {themeCSS && (
          <style
            id='theme-override'
            dangerouslySetInnerHTML={{
              __html: themeCSS,
            }}
          />
        )}

        {/* Basic head hints that are not covered by the Metadata API */}
        <meta name='color-scheme' content='light dark' />
        <meta name='format-detection' content='telephone=no' />
        <meta httpEquiv='x-ua-compatible' content='ie=edge' />

        {/* Google Tag Manager — hosted only */}
        {isHosted && (
          <Script
            id='gtm'
            strategy='afterInteractive'
            dangerouslySetInnerHTML={{
              __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');`,
            }}
          />
        )}

        {/* Google Analytics (gtag.js) — hosted only */}
        {isHosted && (
          <>
            <Script
              id='gtag-src'
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy='afterInteractive'
            />
            <Script
              id='gtag-init'
              strategy='afterInteractive'
              dangerouslySetInnerHTML={{
                __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`,
              }}
            />
          </>
        )}

        {isHosted ? <PublicEnvScript /> : <RuntimePublicEnvScript />}
      </head>
      <body className={`${season.variable} font-season`} suppressHydrationWarning>
        {/* Google Tag Manager (noscript) — hosted only */}
        {isHosted && (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
              title='Google Tag Manager'
              height='0'
              width='0'
              className='invisible hidden'
            />
          </noscript>
        )}
        <HydrationErrorHandler />
        <DesktopUpdateGate />
        <NuqsAdapter>
          <PostHogProvider>
            <ThemeProvider>
              <QueryProvider>
                <SessionProvider>
                  <TooltipProvider>
                    <BrandedLayout>{children}</BrandedLayout>
                  </TooltipProvider>
                </SessionProvider>
              </QueryProvider>
            </ThemeProvider>
          </PostHogProvider>
        </NuqsAdapter>
      </body>
    </html>
  )
}
