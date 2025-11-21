import type { Metadata, Viewport } from 'next'
import { PublicEnvScript } from 'next-runtime-env'
import { BrandedLayout } from '@/components/branded-layout'
import { generateThemeCSS } from '@/lib/branding/inject-theme'
import { generateBrandedMetadata, generateStructuredData } from '@/lib/branding/metadata'
import { PostHogProvider } from '@/app/_shell/providers/posthog-provider'
import '@/app/_styles/globals.css'

import { OneDollarStats } from '@/components/analytics/onedollarstats'
import { HydrationErrorHandler } from '@/app/_shell/hydration-error-handler'
import { QueryProvider } from '@/app/_shell/providers/query-provider'
import { SessionProvider } from '@/app/_shell/providers/session-provider'
import { ThemeProvider } from '@/app/_shell/providers/theme-provider'
import { ZoomPrevention } from '@/app/_shell/zoom-prevention'
import { season } from '@/app/_styles/fonts/season/season'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0c0c' },
  ],
}

export const metadata: Metadata = generateBrandedMetadata()

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const structuredData = generateStructuredData()
  const themeCSS = generateThemeCSS()

  return (
    <html lang='en' suppressHydrationWarning>
      <head>
        {/* Structured Data for SEO */}
        <script
          type='application/ld+json'
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(structuredData),
          }}
        />

        {/* Workspace layout dimensions: set CSS vars before hydration to avoid layout jump */}
        <script
          id='workspace-layout-dimensions'
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var path = window.location.pathname;
                  if (path.indexOf('/workspace/') === -1) {
                    return;
                  }
                } catch (e) {
                  return;
                }

                // Sidebar width
                try {
                  var stored = localStorage.getItem('sidebar-state');
                  if (stored) {
                    var parsed = JSON.parse(stored);
                    var state = parsed && parsed.state;
                    var width = state && state.sidebarWidth;
                    var maxSidebarWidth = window.innerWidth * 0.3;

                    if (width >= 232 && width <= maxSidebarWidth) {
                      document.documentElement.style.setProperty('--sidebar-width', width + 'px');
                    } else if (width > maxSidebarWidth) {
                      document.documentElement.style.setProperty('--sidebar-width', maxSidebarWidth + 'px');
                    }
                  }
                } catch (e) {
                  // Fallback handled by CSS defaults
                }

                // Panel width and active tab
                try {
                  var panelStored = localStorage.getItem('panel-state');
                  if (panelStored) {
                    var panelParsed = JSON.parse(panelStored);
                    var panelState = panelParsed && panelParsed.state;
                    var panelWidth = panelState && panelState.panelWidth;
                    var maxPanelWidth = window.innerWidth * 0.4;

                    if (panelWidth >= 244 && panelWidth <= maxPanelWidth) {
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

                // Toolbar triggers height
                try {
                  var toolbarStored = localStorage.getItem('toolbar-state');
                  if (toolbarStored) {
                    var toolbarParsed = JSON.parse(toolbarStored);
                    var toolbarState = toolbarParsed && toolbarParsed.state;
                    var toolbarTriggersHeight = toolbarState && toolbarState.toolbarTriggersHeight;
                    if (
                      toolbarTriggersHeight !== undefined &&
                      toolbarTriggersHeight >= 30 &&
                      toolbarTriggersHeight <= 800
                    ) {
                      document.documentElement.style.setProperty(
                        '--toolbar-triggers-height',
                        toolbarTriggersHeight + 'px'
                      );
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

        {/* OneDollarStats Analytics */}
        <script defer src='https://assets.onedollarstats.com/stonks.js' />

        <PublicEnvScript />
      </head>
      <body className={`${season.variable} font-season`} suppressHydrationWarning>
        <HydrationErrorHandler />
        <OneDollarStats />
        <PostHogProvider>
          <ThemeProvider>
            <QueryProvider>
              <SessionProvider>
                <BrandedLayout>
                  <ZoomPrevention />
                  {children}
                </BrandedLayout>
              </SessionProvider>
            </QueryProvider>
          </ThemeProvider>
        </PostHogProvider>
      </body>
    </html>
  )
}
