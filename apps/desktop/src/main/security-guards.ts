import { createLogger } from '@sim/logger'
import type { WebContents } from 'electron'
import { app } from 'electron'
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
 */
export function attachNavigationGuards(contents: WebContents, deps: GuardDeps): void {
  const handle = (event: { preventDefault(): void }, url: string) => {
    const action = classifyNavigation(url, {
      appOrigin: deps.appOrigin(),
      currentUrl: contents.getURL(),
      isPopup: deps.isPopupContents(contents),
    })
    switch (action) {
      case 'in-app':
      case 'idp-in-window':
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
 * popups, blank children, settings — gets webview blocking, packaged DevTools
 * lockdown, a default-deny window.open handler (specific policies overwrite
 * it), and the navigation classifier. TLS errors are always fatal when
 * packaged; self-host private CAs must be system-trusted rather than bypassed
 * in-app.
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
    attachNavigationGuards(contents, deps)
  })

  app.on('certificate-error', (event, _webContents, url, error, _certificate, callback) => {
    event.preventDefault()
    callback(false)
    logger.warn('Rejected TLS certificate', { url: scrubUrl(url), error })
  })
}
