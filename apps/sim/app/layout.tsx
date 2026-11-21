import { INTEGRATION_COUNT_LABEL } from '@sim/deployment-config/integration-claims'
import { ToastProvider } from '@sim/emcn'
import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { SettingsNavigationGuard } from '@/components/settings/settings-navigation-guard'
import { PasteAdmissionGuard } from '@/app/_shell/paste-admission-guard'
import { BrowserTelemetry } from '@/app/_shell/providers/browser-telemetry'
import { PostHogProvider } from '@/app/_shell/providers/posthog-provider'
import '@/app/_styles/globals.css'
import { env } from '@/lib/core/config/env'
import {
  isChatEnabled,
  isHosted,
  isReactGrabEnabled,
  isReactScanEnabled,
} from '@/lib/core/config/env-flags'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { ConsentProvider } from '@/app/_shell/consent/consent-provider'
import { DesktopUpdateGate } from '@/app/_shell/desktop-update-gate'
import { DesktopUpdateNotification } from '@/app/_shell/desktop-update-notification'
import { HydrationErrorHandler } from '@/app/_shell/hydration-error-handler'
import { QueryProvider } from '@/app/_shell/providers/query-provider'
import { SessionProvider } from '@/app/_shell/providers/session-provider'
import { ThemeProvider } from '@/app/_shell/providers/theme-provider'
import { TooltipProvider } from '@/app/_shell/providers/tooltip-provider'
import {
  deploymentShapeHtmlAttributes,
  PublicEnvScript,
  publicEnvHtmlAttributes,
  RuntimePublicEnvScript,
} from '@/app/_shell/public-env-script'
import { season } from '@/app/_styles/fonts/season/season'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0c0c' },
  ],
}

const SUMMARY_FULL = `Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Connect ${INTEGRATION_COUNT_LABEL} integrations and every major LLM to create agents that automate real work — visually, conversationally, or with code. Trusted by over 100,000 builders — from startups to Fortune 500 companies. SOC2 compliant.`
const SUMMARY_SHORT = `Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Connect ${INTEGRATION_COUNT_LABEL} integrations and every major LLM to create agents that automate real work.`

/**
 * Root metadata every route inherits. Deliberately sets no `alternates.canonical`
 * or `openGraph.url`: a fixed value would make each page claim the home page as
 * its canonical. Landing pages emit their own canonical URLs.
 */
export const metadata: Metadata = {
  title: {
    template: '%s | Sim',
    default: 'Sim',
  },
  description: SUMMARY_SHORT,
  applicationName: 'Sim',
  authors: [{ name: 'Sim' }],
  generator: 'Next.js',
  keywords: [
    'AI workspace',
    'AI agent builder',
    'AI agent workflow builder',
    'build AI agents',
    'visual workflow builder',
    'AI agents',
    'AI agent platform',
    'open-source AI agents',
    'agentic workflows',
    'LLM orchestration',
    'AI integrations',
    'knowledge base',
    'AI automation',
    'workflow builder',
    'AI workflow orchestration',
    'enterprise AI',
    'AI agent deployment',
    'intelligent automation',
    'AI tools',
  ],
  referrer: 'origin-when-cross-origin',
  creator: 'Sim',
  publisher: 'Sim',
  metadataBase: new URL(getBaseUrl()),
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-video-preview': -1,
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    title: 'Sim',
    description: SUMMARY_FULL,
    siteName: 'Sim',
    images: [
      {
        url: '/logo/426-240/reverse/small.png',
        width: 2130,
        height: 1200,
        alt: 'Sim',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sim',
    description: SUMMARY_FULL,
    images: ['/logo/426-240/reverse/small.png'],
    creator: '@simdotai',
    site: '@simdotai',
  },
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
      { url: '/favicon/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      {
        url: '/favicon/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        url: '/favicon/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
    apple: '/favicon/apple-touch-icon.png',
    shortcut: '/icon.svg',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Sim',
  },
  formatDetection: {
    telephone: false,
  },
  category: 'technology',
  other: {
    'apple-mobile-web-app-capable': 'yes',
    'mobile-web-app-capable': 'yes',
    'msapplication-TileColor': '#33C482',
    'msapplication-config': 'none',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const application = (
    <ToastProvider>
      <SettingsNavigationGuard />
      <DesktopUpdateNotification />
      <PasteAdmissionGuard />
      <PostHogProvider consentRequired={isHosted}>
        <ThemeProvider>
          <QueryProvider>
            <SessionProvider>
              <BrowserTelemetry
                disabled={env.NEXT_TELEMETRY_DISABLED === '1'}
                consentRequired={isHosted}
              />
              <TooltipProvider>{children}</TooltipProvider>
            </SessionProvider>
          </QueryProvider>
        </ThemeProvider>
      </PostHogProvider>
    </ToastProvider>
  )

  return (
    <html
      lang='en'
      suppressHydrationWarning
      {...publicEnvHtmlAttributes()}
      {...deploymentShapeHtmlAttributes()}
    >
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

                // The organization surface (/o/...) shares the workspace chrome and
                // needs the same variables set before first paint.
                try {
                  var path = window.location.pathname;
                  if (path.indexOf('/workspace/') === -1 && path.indexOf('/o/') !== 0 && path.indexOf('/account/settings') !== 0 && path.indexOf('/selfhost/settings') !== 0) {
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
                    // The Code tab is flag-gated per workspace, which this script cannot
                    // know; the toolbar paints first and React switches to Code if enabled.
                    if (activeTab === 'code') {
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
