import type { Metadata, Viewport } from 'next'
import { PublicEnvScript } from 'next-runtime-env'
import { BrandedLayout } from '@/components/branded-layout'
import { generateThemeCSS } from '@/lib/branding/inject-theme'
import { generateBrandedMetadata, generateStructuredData } from '@/lib/branding/metadata'
import { PostHogProvider } from '@/lib/posthog/provider'
import '@/app/globals.css'

import { SessionProvider } from '@/lib/session/session-context'
import { season } from '@/app/fonts/season/season'
import { HydrationErrorHandler } from '@/app/hydration-error-handler'
import { ThemeProvider } from '@/app/theme-provider'
import { ZoomPrevention } from '@/app/zoom-prevention'

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

        {/* Blocking script to prevent sidebar dimensions flash on page load */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var stored = localStorage.getItem('sidebar-state');
                  if (stored) {
                    var parsed = JSON.parse(stored);
                    var state = parsed?.state;
                    
                    // Set sidebar width
                    var width = state?.sidebarWidth;
                    if (width >= 232 && width <= 400) {
                      document.documentElement.style.setProperty('--sidebar-width', width + 'px');
                    }
                  }
                } catch (e) {
                  // Fallback handled by CSS defaults
                }
                
                // Set panel width and active tab
                try {
                  var panelStored = localStorage.getItem('panel-state');
                  if (panelStored) {
                    var panelParsed = JSON.parse(panelStored);
                    var panelState = panelParsed?.state;
                    var panelWidth = panelState?.panelWidth;
                    if (panelWidth >= 236 && panelWidth <= 400) {
                      document.documentElement.style.setProperty('--panel-width', panelWidth + 'px');
                    }
                    
                    // Set active tab to prevent flash on hydration
                    var activeTab = panelState?.activeTab;
                    if (activeTab) {
                      document.documentElement.setAttribute('data-panel-active-tab', activeTab);
                    }
                  }
                } catch (e) {
                  // Fallback handled by CSS defaults
                }
                
                // Set toolbar triggers height
                try {
                  var toolbarStored = localStorage.getItem('toolbar-state');
                  if (toolbarStored) {
                    var toolbarParsed = JSON.parse(toolbarStored);
                    var toolbarState = toolbarParsed?.state;
                    var toolbarTriggersHeight = toolbarState?.toolbarTriggersHeight;
                    if (toolbarTriggersHeight !== undefined && toolbarTriggersHeight >= 100 && toolbarTriggersHeight <= 800) {
                      document.documentElement.style.setProperty('--toolbar-triggers-height', toolbarTriggersHeight + 'px');
                    }
                  }
                } catch (e) {
                  // Fallback handled by CSS defaults
                }
              })();
            `,
          }}
        />

        <PublicEnvScript />
      </head>
      <body className={`${season.variable} font-season`} suppressHydrationWarning>
        <HydrationErrorHandler />
        <PostHogProvider>
          <ThemeProvider>
            <SessionProvider>
              <BrandedLayout>
                <ZoomPrevention />
                {children}
              </BrandedLayout>
            </SessionProvider>
          </ThemeProvider>
        </PostHogProvider>
      </body>
    </html>
  )
}
