/**
 * Right-click menu for the embedded browser page.
 *
 * Native, deliberately. The page is a native view composited OVER the renderer,
 * so a menu drawn from the app's own dropdown can only appear by freezing the
 * page to a captured frame and hiding the view beneath it. That frame has to
 * pixel-match a live compositor surface, and scrollbars, device scale, and
 * resize timing all conspire against it — a mismatch shows up as the page
 * flickering or shifting under the menu. A native menu draws above the view
 * while the page keeps rendering, so none of that applies.
 *
 * It is also what a browser's page menu is everywhere else, and unlike the
 * terminal's hidden textarea, the roles here act on a real page: `copy` and
 * `paste` go to the frame that was clicked.
 */
import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron'
import { clipboard, Menu } from 'electron'

/**
 * Page-zoom ladder for the embedded browser, in Chromium's absolute zoom
 * factors. The ends are the platform's own limits, not a product choice —
 * Chromium refuses to scale past them, and a rung outside the range would come
 * back clamped and leave the menu offering a step that never lands.
 */
const ZOOM_STEP_RATIO = 1.1
const MIN_ZOOM_FACTOR = 0.5
const MAX_ZOOM_FACTOR = 3

/**
 * What the panel calls 100%.
 *
 * The browser lives in a panel that is only ever a fraction of the window, so
 * it renders a rung below Chromium's native scale and treats THAT as its
 * baseline: the menu reads 100% there, and every other rung is reported
 * relative to it. Users get a zoom control that behaves the way one should —
 * starts at 100%, resets to 100% — over a page that is genuinely rendering at
 * ~91% of native.
 *
 * Defined as one rung below native rather than as a round number so the ladder
 * still lands exactly on Chromium's 1.0 (the crispest rasterization, one step
 * up from the baseline) instead of straddling it.
 */
export const BASE_ZOOM_FACTOR = 1 / ZOOM_STEP_RATIO

/**
 * A Chromium zoom factor as a percentage of {@link BASE_ZOOM_FACTOR} — what the
 * menu shows and what "100%" means everywhere in the browser panel's UI.
 *
 * Only display and the reset target convert; the ladder itself stays in
 * absolute factors, so stepping never round-trips through this and cannot
 * accumulate float drift away from the rungs.
 */
export function zoomPercentOf(factor: number): number {
  return Math.round((factor / BASE_ZOOM_FACTOR) * 100)
}

/**
 * One step along the zoom ladder, clamped to its ends. Returning the current
 * factor unchanged is how the menu knows an end is reached, so it can disable
 * the item rather than offer a step that does nothing.
 */
export function steppedZoomFactor(current: number, direction: 1 | -1): number {
  const base = Number.isFinite(current) && current > 0 ? current : BASE_ZOOM_FACTOR
  const next = direction === 1 ? base * ZOOM_STEP_RATIO : base / ZOOM_STEP_RATIO
  return Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, next))
}

/** The parts of a right-click the menu acts on. */
type AgentContextMenuParams = Pick<
  ContextMenuParams,
  'selectionText' | 'linkURL' | 'isEditable' | 'editFlags'
>

/** What the page can currently do, read at the moment of the click. */
interface AgentPageContext {
  canGoBack: boolean
  canGoForward: boolean
  zoomFactor: number
}

interface AgentContextMenuHandlers {
  copy(): void
  paste(): void
  back(): void
  forward(): void
  reload(): void
  openTab(url: string): void
  copyLink(url: string): void
  setZoomFactor(factor: number): void
}

export interface AgentContextMenuHost {
  /** Opens a link from the page in another tab of the same browser. */
  openTab(url: string): void
}

/**
 * Builds the page menu. Unlike the main window's menu this is never empty —
 * navigation and zoom always apply, and only the clipboard and link items
 * depend on what was clicked.
 *
 * Only http(s) links get link items: the actions open a browser tab or copy an
 * address, and neither means anything for a `javascript:` or `mailto:` target.
 */
export function buildAgentContextMenuTemplate(
  params: AgentContextMenuParams,
  page: AgentPageContext,
  handlers: AgentContextMenuHandlers
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = []
  const linkUrl = /^https?:\/\//i.test(params.linkURL) ? params.linkURL : ''

  if (linkUrl) {
    template.push(
      { label: 'Open Link in New Tab', click: () => handlers.openTab(linkUrl) },
      { label: 'Copy Link Address', click: () => handlers.copyLink(linkUrl) },
      { type: 'separator' }
    )
  }

  if (params.selectionText.trim()) {
    template.push({ label: 'Copy', click: () => handlers.copy() })
  }
  if (params.isEditable && params.editFlags.canPaste) {
    template.push({ label: 'Paste', click: () => handlers.paste() })
  }
  if (template.length > 0 && template[template.length - 1].type !== 'separator') {
    template.push({ type: 'separator' })
  }

  template.push(
    { label: 'Back', enabled: page.canGoBack, click: () => handlers.back() },
    { label: 'Forward', enabled: page.canGoForward, click: () => handlers.forward() },
    { label: 'Reload', click: () => handlers.reload() },
    { type: 'separator' }
  )

  const zoomIn = steppedZoomFactor(page.zoomFactor, 1)
  const zoomOut = steppedZoomFactor(page.zoomFactor, -1)
  const zoomPercent = zoomPercentOf(page.zoomFactor)
  template.push(
    {
      label: 'Zoom In',
      enabled: zoomIn !== page.zoomFactor,
      click: () => handlers.setZoomFactor(zoomIn),
    },
    {
      label: 'Zoom Out',
      enabled: zoomOut !== page.zoomFactor,
      click: () => handlers.setZoomFactor(zoomOut),
    },
    {
      label: `Actual Size (${zoomPercent}%)`,
      enabled: zoomPercent !== 100,
      click: () => handlers.setZoomFactor(BASE_ZOOM_FACTOR),
    }
  )

  return template
}

/** Gives one agent tab its page menu. */
export function attachAgentContextMenu(contents: WebContents, host: AgentContextMenuHost): void {
  contents.on('context-menu', (_event, params) => {
    const template = buildAgentContextMenuTemplate(
      params,
      {
        canGoBack: contents.navigationHistory.canGoBack(),
        canGoForward: contents.navigationHistory.canGoForward(),
        zoomFactor: contents.getZoomFactor(),
      },
      {
        copy: () => contents.copy(),
        paste: () => contents.paste(),
        back: () => contents.navigationHistory.goBack(),
        forward: () => contents.navigationHistory.goForward(),
        reload: () => contents.reload(),
        openTab: (url) => host.openTab(url),
        copyLink: (url) => clipboard.writeText(url),
        setZoomFactor: (factor) => contents.setZoomFactor(factor),
      }
    )
    Menu.buildFromTemplate(template).popup()
  })
}
