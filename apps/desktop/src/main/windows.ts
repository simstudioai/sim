import { createLogger } from '@sim/logger'
import type { BrowserWindow, WebContents } from 'electron'
import {
  classifyBlankChildNavigation,
  classifyWindowOpen,
  openExternalSafe,
} from '@/main/navigation'

const logger = createLogger('DesktopWindows')

const popupContents = new WeakSet<WebContents>()

/**
 * Marks a WebContents as a guarded popup child (MCP OAuth, blank-then-assign)
 * so the navigation classifier can apply the more permissive popup policy.
 */
export function registerPopupContents(contents: WebContents): void {
  popupContents.add(contents)
}

export function isPopupContents(contents: WebContents): boolean {
  return popupContents.has(contents)
}

export interface WindowPolicyDeps {
  appOrigin: () => string
  getMainWindow: () => BrowserWindow | null
  allowHttpLocalhost: boolean
}

/**
 * Applies the window.open routing policy to a WebContents. Internal "new tab"
 * opens collapse into the main window (single-window policy); MCP OAuth
 * popups and blank-then-assign children are allowed in the same partition so
 * window.opener/postMessage keep working; everything else goes to the system
 * browser.
 */
export function attachWindowOpenPolicy(contents: WebContents, deps: WindowPolicyDeps): void {
  contents.setWindowOpenHandler((details) => {
    const action = classifyWindowOpen(details.url, details.frameName, deps.appOrigin())
    switch (action) {
      case 'popup-mcp':
      case 'popup-blank':
        return { action: 'allow' }
      case 'popup-internal': {
        const main = deps.getMainWindow()
        if (main && !main.isDestroyed()) {
          void main.loadURL(details.url)
          main.focus()
        }
        return { action: 'deny' }
      }
      case 'external':
        void openExternalSafe(details.url, deps.allowHttpLocalhost)
        return { action: 'deny' }
      default:
        logger.warn('Denied window.open', { url: details.url.slice(0, 200) })
        return { action: 'deny' }
    }
  })

  contents.on('did-create-window', (child, details) => {
    registerPopupContents(child.webContents)
    attachWindowOpenPolicy(child.webContents, deps)
    const kind = classifyWindowOpen(details.url, details.frameName, deps.appOrigin())
    if (kind === 'popup-blank') {
      attachBlankChildGuards(child, deps)
    }
  })
}

/**
 * Routes the first real navigation of an about:blank child: same-origin URLs
 * collapse into the main window, external URLs open in the system browser,
 * and the child closes either way.
 */
function attachBlankChildGuards(child: BrowserWindow, deps: WindowPolicyDeps): void {
  child.webContents.on('will-navigate', (event, url) => {
    const action = classifyBlankChildNavigation(url, deps.appOrigin())
    if (action === 'ignore') {
      return
    }
    event.preventDefault()
    if (action === 'internal') {
      const main = deps.getMainWindow()
      if (main && !main.isDestroyed()) {
        void main.loadURL(url)
        main.focus()
      }
    } else if (action === 'external') {
      void openExternalSafe(url, deps.allowHttpLocalhost)
    }
    if (!child.isDestroyed()) {
      child.close()
    }
  })
}
