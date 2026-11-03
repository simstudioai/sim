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
 * terminal's hidden textarea, the edit items act on a real page: `copy` and
 * `paste` go to the frame that was clicked.
 */

import { resolveDesktopZoom } from '@sim/desktop-bridge'
import type { ContextMenuParams, MenuItemConstructorOptions, Referrer, WebContents } from 'electron'
import { clipboard, Menu } from 'electron'
import {
  clearAgentContextMenu,
  consumeAgentContextMenu,
  isDispatchingAgentInput,
} from '@/main/browser-agent/cdp'
import { menuReferrer, referrerForRequest } from '@/main/browser-agent/referrer'
import { spellingItems } from '@/main/context-menu'
import { parseHttpUrl } from '@/main/navigation'

/**
 * Page-zoom ladder for the embedded browser, in Chromium's absolute zoom
 * factors. The ends are the platform's own limits, not a product choice —
 * Chromium refuses to scale past them, and a rung outside the range would come
 * back clamped and leave the menu offering a step that never lands.
 */
const MIN_ZOOM_FACTOR = 0.5
const MAX_ZOOM_FACTOR = 3
const ZOOM_FACTOR_BOUNDS = { min: MIN_ZOOM_FACTOR, max: MAX_ZOOM_FACTOR } as const

/**
 * What the panel calls 100%.
 *
 * The browser lives in a panel that is only ever a fraction of the window, so
 * it renders a rung below Chromium's native scale and treats THAT as its
 * baseline: the menu reads 100% there, and every other rung is reported
 * relative to it. New installs start there; when a user chooses a different
 * default, Actual Size returns to that configured percentage. The initial 100%
 * is genuinely rendering at ~91% of native.
 *
 * Defined as one rung below native rather than as a round number so the ladder
 * still lands exactly on Chromium's 1.0 (the crispest rasterization, one step
 * up from the baseline) instead of straddling it.
 */
export const BASE_ZOOM_FACTOR = resolveDesktopZoom(1, 'out', 1, ZOOM_FACTOR_BOUNDS)

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
  return resolveDesktopZoom(
    current,
    direction === 1 ? 'in' : 'out',
    BASE_ZOOM_FACTOR,
    ZOOM_FACTOR_BOUNDS
  )
}

/** The parts of a right-click the menu acts on. */
type AgentContextMenuParams = Pick<
  ContextMenuParams,
  | 'selectionText'
  | 'linkURL'
  | 'isEditable'
  | 'editFlags'
  | 'misspelledWord'
  | 'dictionarySuggestions'
  | 'mediaType'
  | 'srcURL'
  | 'hasImageContents'
>

/** What the page can currently do, read at the moment of the click. */
interface AgentPageContext {
  canGoBack: boolean
  canGoForward: boolean
  zoomFactor: number
  defaultZoomFactor: number
}

/** A history move or reload started from browser chrome rather than by the page. */
export type PageNavigation = 'back' | 'forward' | 'reload'

/**
 * Edit actions are explicit calls on this page rather than menu roles: a role
 * acts on whichever contents holds focus, and a right-click need not focus the page.
 */
interface AgentContextMenuHandlers {
  addToChat(text: string): void
  replaceMisspelling(word: string): void
  addToDictionary(word: string): void
  undo(): void
  redo(): void
  cut(): void
  copy(): void
  paste(): void
  pasteAndMatchStyle(): void
  selectAll(): void
  navigate(kind: PageNavigation): void
  openTab(url: string): void
  copyLink(url: string): void
  copyImage(): void
  saveImage(url: string): void
  setZoomFactor(factor: number): void
}

export interface AgentContextMenuHost {
  /** Attaches selected page text to the chat that owns this browser tab. */
  addToChat(text: string): void
  /** Opens a URL from the page in another tab of the same browser. */
  openTab(url: string, referrer: Referrer): void
  /** Returns the device's current default page zoom factor. */
  defaultZoomFactor(): number
  history(): Pick<AgentPageContext, 'canGoBack' | 'canGoForward'>
  /** Runs through the user-navigation path, so a page's leave-site question reaches the user. */
  navigate(kind: PageNavigation): void
}

const isWebUrl = (url: string) => parseHttpUrl(url) !== null

/** Ends the template with one separator, never two in a row or one at the top. */
function endGroup(template: MenuItemConstructorOptions[]): void {
  if (template.length > 0 && template[template.length - 1].type !== 'separator') {
    template.push({ type: 'separator' })
  }
}

/**
 * Builds the page menu. Unlike the main window's menu this is never empty —
 * navigation and zoom always apply, and only the spelling, clipboard, link, and
 * image items depend on what was clicked.
 *
 * Only http(s) links and image sources get address items: the actions open a
 * browser tab, download, or copy an address, and none of them means anything
 * for a `javascript:`, `data:`, or `blob:` target. Copy Image needs no address,
 * so it is offered for any loaded image.
 */
export function buildAgentContextMenuTemplate(
  params: AgentContextMenuParams,
  page: AgentPageContext,
  handlers: AgentContextMenuHandlers
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = []
  const linkUrl = isWebUrl(params.linkURL) ? params.linkURL : ''
  const imageUrl = isWebUrl(params.srcURL) ? params.srcURL : ''
  const selectionText = params.selectionText
  const flags = params.editFlags

  template.push(...spellingItems(params, handlers))
  endGroup(template)

  if (selectionText.trim()) {
    template.push(
      { label: 'Add to chat', click: () => handlers.addToChat(selectionText) },
      { type: 'separator' }
    )
  }

  if (linkUrl) {
    template.push(
      { label: 'Open Link in New Tab', click: () => handlers.openTab(linkUrl) },
      { label: 'Copy Link Address', click: () => handlers.copyLink(linkUrl) },
      { type: 'separator' }
    )
  }

  if (params.mediaType === 'image') {
    const copyImage: MenuItemConstructorOptions[] = params.hasImageContents
      ? [{ label: 'Copy Image', click: () => handlers.copyImage() }]
      : []
    template.push(
      ...(imageUrl
        ? [
            { label: 'Open Image in New Tab', click: () => handlers.openTab(imageUrl) },
            { label: 'Save Image', click: () => handlers.saveImage(imageUrl) },
            ...copyImage,
            { label: 'Copy Image Address', click: () => handlers.copyLink(imageUrl) },
          ]
        : copyImage)
    )
    endGroup(template)
  }

  if (params.isEditable) {
    template.push(
      { label: 'Undo', enabled: flags.canUndo, click: () => handlers.undo() },
      { label: 'Redo', enabled: flags.canRedo, click: () => handlers.redo() },
      { type: 'separator' },
      { label: 'Cut', enabled: flags.canCut, click: () => handlers.cut() },
      { label: 'Copy', enabled: flags.canCopy, click: () => handlers.copy() },
      { label: 'Paste', enabled: flags.canPaste, click: () => handlers.paste() },
      {
        label: 'Paste and Match Style',
        enabled: flags.canPaste,
        click: () => handlers.pasteAndMatchStyle(),
      },
      { label: 'Select All', enabled: flags.canSelectAll, click: () => handlers.selectAll() }
    )
  } else if (selectionText.trim()) {
    template.push({ label: 'Copy', click: () => handlers.copy() })
  }
  endGroup(template)

  template.push(
    { label: 'Back', enabled: page.canGoBack, click: () => handlers.navigate('back') },
    { label: 'Forward', enabled: page.canGoForward, click: () => handlers.navigate('forward') },
    { label: 'Reload', click: () => handlers.navigate('reload') },
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
      enabled: page.zoomFactor !== page.defaultZoomFactor,
      click: () => handlers.setZoomFactor(page.defaultZoomFactor),
    }
  )

  return template
}

/** Gives one agent tab its page menu; an agent right-click reaches only the page's own handlers. */
export function attachAgentContextMenu(contents: WebContents, host: AgentContextMenuHost): void {
  contents.on('input-event', (_event, input) => {
    if (
      ['mouseDown', 'keyDown', 'rawKeyDown', 'char', 'touchStart'].includes(input.type) &&
      !isDispatchingAgentInput(contents)
    ) {
      clearAgentContextMenu(contents)
    }
  })
  contents.on('context-menu', (_event, params) => {
    if (consumeAgentContextMenu(contents)) return
    const template = buildAgentContextMenuTemplate(
      params,
      {
        ...host.history(),
        zoomFactor: contents.getZoomFactor(),
        defaultZoomFactor: host.defaultZoomFactor(),
      },
      {
        addToChat: (text) => host.addToChat(text),
        replaceMisspelling: (word) => contents.replaceMisspelling(word),
        addToDictionary: (word) => contents.session.addWordToSpellCheckerDictionary(word),
        undo: () => contents.undo(),
        redo: () => contents.redo(),
        cut: () => contents.cut(),
        copy: () => contents.copy(),
        paste: () => contents.paste(),
        pasteAndMatchStyle: () => contents.pasteAndMatchStyle(),
        selectAll: () => contents.selectAll(),
        navigate: (kind) => host.navigate(kind),
        openTab: (url) => host.openTab(url, menuReferrer(params)),
        copyLink: (url) => clipboard.writeText(url),
        copyImage: () => contents.copyImageAt(params.x, params.y),
        // A download, so the browser's download limits and request guards apply. Electron maps a
        // Referer header into the download's referrer, so referrer-protected images still save.
        saveImage: (url) => {
          const referrer = referrerForRequest(menuReferrer(params), url)
          contents.downloadURL(url, referrer ? { headers: { Referer: referrer } } : undefined)
        },
        setZoomFactor: (factor) => contents.setZoomFactor(factor),
      }
    )
    Menu.buildFromTemplate(template).popup()
  })
}
