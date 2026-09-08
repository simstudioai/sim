import { ToastProvider } from '@sim/emcn'
import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { BrandedLayout } from '@/components/branded-layout'
import { PasteAdmissionGuard } from '@/app/_shell/paste-admission-guard'
import { BrowserTelemetry } from '@/app/_shell/providers/browser-telemetry'
import { PostHogProvider } from '@/app/_shell/providers/posthog-provider'
import { generateBrandedMetadata, generateThemeCSS } from '@/ee/whitelabeling'
import '@/app/_styles/globals.css'
import { env } from '@/lib/core/config/env'
import {
  isChatEnabled,
  isHosted,
  isReactGrabEnabled,
  isReactScanEnabled,
} from '@/lib/core/config/env-flags'
import { ConsentProvider } from '@/app/_shell/consent/consent-provider'
import { DesktopUpdateGate } from '@/app/_shell/desktop-update-gate'
import { HydrationErrorHandler } from '@/app/_shell/hydration-error-handler'
import { QueryProvider } from '@/app/_shell/providers/query-provider'
import { SessionProvider } from '@/app/_shell/providers/session-provider'
import { ThemeProvider } from '@/app/_shell/providers/theme-provider'
import { TooltipProvider } from '@/app/_shell/providers/tooltip-provider'
import {
  PublicEnvScript,
  publicEnvHtmlAttributes,
  RuntimePublicEnvScript,
} from '@/app/_shell/public-env-script'
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const themeCSS = generateThemeCSS()
  const application = (
    <ToastProvider>
      <PasteAdmissionGuard />
      <PostHogProvider consentRequired={isHosted}>
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
      </PostHogProvider>
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
                var collapsedSidebarWidth = 48;
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
                // the upper bound can never fall below the 238px minimum, so a narrow
                // window yields a width >= MIN instead of a sub-minimum sliver.
                var defaultSidebarWidth = 238;
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
                  var maxSidebarWidth = Math.max(238, window.innerWidth * 0.3);
                  var expandedWidth =
                    typeof width === 'number' && isFinite(width)
                      ? Math.min(Math.max(width, 238), maxSidebarWidth)
                      : defaultSidebarWidth;
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
                    // A session that used the Chat tab before it was turned off still
                    // has 'copilot' persisted; without this the CSS hides every tab
                    // body and the panel paints empty.
                    if (activeTab === 'copilot' && !${isChatEnabled}) {
                      activeTab = 'toolbar';
                    }
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

        {isHosted ? <PublicEnvScript /> : <RuntimePublicEnvScript />}
      </head>
      <body className={`${season.variable} font-season`} suppressHydrationWarning>
        <HydrationErrorHandler />
        <DesktopUpdateGate />
        <NuqsAdapter>
          {isHosted ? <ConsentProvider>{application}</ConsentProvider> : application}
        </NuqsAdapter>
      </body>
    </html>
  )
}
