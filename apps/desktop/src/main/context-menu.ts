import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron'
import { clipboard, Menu } from 'electron'
import { openExternalSafe } from '@/main/navigation'

const MAX_SUGGESTIONS = 5

export interface ContextMenuDeps {
  isDev: boolean
  allowHttpLocalhost: boolean
}

interface TemplateHandlers {
  replaceMisspelling(word: string): void
  addToDictionary(word: string): void
  openLink(url: string): void
  copyLink(url: string): void
  inspect(x: number, y: number): void
}

/**
 * Builds the native right-click menu for a given context. Returns an empty
 * template when there is nothing editable, selected, or linked — which leaves
 * canvas areas and custom React context menus alone.
 */
export function buildContextMenuTemplate(
  params: Pick<
    ContextMenuParams,
    | 'misspelledWord'
    | 'dictionarySuggestions'
    | 'isEditable'
    | 'selectionText'
    | 'linkURL'
    | 'x'
    | 'y'
  >,
  deps: { isDev: boolean },
  handlers: TemplateHandlers
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = []

  if (params.misspelledWord) {
    for (const suggestion of params.dictionarySuggestions.slice(0, MAX_SUGGESTIONS)) {
      template.push({ label: suggestion, click: () => handlers.replaceMisspelling(suggestion) })
    }
    if (params.dictionarySuggestions.length === 0) {
      template.push({ label: 'No Guesses Found', enabled: false })
    }
    template.push(
      { label: 'Add to Dictionary', click: () => handlers.addToDictionary(params.misspelledWord) },
      { type: 'separator' }
    )
  }

  if (params.isEditable) {
    template.push(
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { type: 'separator' },
      { role: 'selectAll' }
    )
  } else if (params.selectionText.trim()) {
    template.push({ role: 'copy' })
  }

  if (params.linkURL) {
    if (template.length > 0) {
      template.push({ type: 'separator' })
    }
    template.push(
      { label: 'Open Link in Browser', click: () => handlers.openLink(params.linkURL) },
      { label: 'Copy Link', click: () => handlers.copyLink(params.linkURL) }
    )
  }

  if (deps.isDev && template.length > 0) {
    template.push(
      { type: 'separator' },
      {
        label: 'Inspect Element',
        click: () => handlers.inspect(params.x, params.y),
      }
    )
  }

  return template
}

/**
 * Attaches the native context menu with spellcheck suggestions to a
 * WebContents. Areas with no text/link context get no native menu so the web
 * app's own menus (workflow canvas, tables) keep owning the right-click.
 */
export function attachContextMenu(contents: WebContents, deps: ContextMenuDeps): void {
  contents.on('context-menu', (_event, params) => {
    const template = buildContextMenuTemplate(
      params,
      { isDev: deps.isDev },
      {
        replaceMisspelling: (word) => contents.replaceMisspelling(word),
        addToDictionary: (word) => contents.session.addWordToSpellCheckerDictionary(word),
        openLink: (url) => void openExternalSafe(url, deps.allowHttpLocalhost),
        copyLink: (url) => clipboard.writeText(url),
        inspect: (x, y) => contents.inspectElement(x, y),
      }
    )
    if (template.length === 0) {
      return
    }
    Menu.buildFromTemplate(template).popup()
  })
}
