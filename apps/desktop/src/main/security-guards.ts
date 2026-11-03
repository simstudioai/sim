import { createLogger } from '@sim/logger'
import type { WebContents, WebFrameMain } from 'electron'
import { app } from 'electron'
import {
  handleBrowserLogin,
  handleSelectClientCertificate,
  requestExternalLaunch,
} from '@/main/browser-agent/page-prompts'
import { isAgentWebContents } from '@/main/browser-agent/registry'
import { trackInputActivity } from '@/main/input-activity'
import { classifyNavigation, openExternalSafe } from '@/main/navigation'
import { scrubUrl } from '@/main/observability'

const logger = createLogger('DesktopSecurityGuards')

export interface GuardDeps {
  appOrigin: () => string
  isPackaged: boolean
  allowHttpLocalhost: () => boolean
  isPopupContents: (contents: WebContents) => boolean
  onLoginHandoff: () => void
  onConnectIntercept: (contents: WebContents) => void
}

/**
 * Applies the top-level navigation policy to both will-navigate and
 * will-redirect — OAuth chains can be redirect-injected, so redirects get the
 * same classifier as direct navigations.
 *
 * Agent-browser tabs never navigate off http(s). A link to another app (Zoom,
 * Teams, mail) becomes a launch request the user decides only when the tab's
 * own top-level document initiated it: a navigation a frame initiated, even
 * one targeting the top level, is refused, as is the `openExternal`
 * permission that backs frame launches.
 */
export function attachNavigationGuards(contents: WebContents, deps: GuardDeps): void {
  const handle = (
    event: { preventDefault(): void; isMainFrame?: boolean; initiator?: WebFrameMain | null },
    url: string
  ) => {
    if (isAgentWebContents(contents)) {
      const hasAllowedAgentBrowserScheme = /^https?:/i.test(url)
      if (!hasAllowedAgentBrowserScheme) {
        event.preventDefault()
        if (event.isMainFrame === true) {
          requestExternalLaunch(contents, url, event.initiator)
        } else logger.warn('Denied non-http navigation in agent browser', { url: scrubUrl(url) })
      }
      return
    }
    const action = classifyNavigation(url, {
      appOrigin: deps.appOrigin(),
      currentUrl: contents.getURL(),
      isPopup: deps.isPopupContents(contents),
    })
    switch (action) {
      case 'in-app':
        return
      case 'external':
        event.preventDefault()
        void openExternalSafe(url, deps.allowHttpLocalhost())
        return
      case 'idp-system-login':
        event.preventDefault()
        deps.onLoginHandoff()
        return
      case 'idp-system-connect':
        event.preventDefault()
        deps.onConnectIntercept(contents)
        return
      default:
        event.preventDefault()
        logger.warn('Denied navigation', { url: scrubUrl(url) })
    }
  }
  contents.on('will-navigate', handle)
  contents.on('will-redirect', handle)
}

/**
 * Global defense-in-depth: every WebContents ever created — main window, MCP
 * popups, blank children, settings, agent-browser tabs — gets webview
 * blocking, packaged DevTools lockdown, a default-deny window.open handler
 * (specific policies overwrite it), and the navigation classifier.
 * Agent-browser tabs swap the classifier for a free-http(s) policy (their job
 * is browsing arbitrary sites, isolated on their own partition). TLS errors
 * are always fatal when packaged; self-host private CAs must be
 * system-trusted rather than bypassed in-app. HTTP authentication and client
 * certificate requests from agent-browser tabs wait on the user; every other
 * contents keeps Electron's defaults.
 */
export function installGlobalGuards(deps: GuardDeps): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
      logger.warn('Blocked webview attach')
    })
    if (deps.isPackaged) {
      contents.on('devtools-opened', () => {
        contents.closeDevTools()
      })
    }
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    trackInputActivity(contents)
    attachNavigationGuards(contents, deps)
  })

  app.on('login', handleBrowserLogin)
  app.on('select-client-certificate', handleSelectClientCertificate)

  app.on('certificate-error', (event, _webContents, url, error, _certificate, callback) => {
    event.preventDefault()
    callback(false)
    logger.warn('Rejected TLS certificate', { url: scrubUrl(url), error })
  })
}
