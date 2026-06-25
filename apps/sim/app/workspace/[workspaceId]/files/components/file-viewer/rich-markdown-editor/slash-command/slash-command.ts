import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import type { Editor } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion'
import {
  filterSlashCommands,
  type SlashCommandContext,
  type SlashCommandItem,
  type SlashCommandStorage,
} from './commands'
import { SlashCommandList, type SlashCommandListHandle } from './slash-command-list'

declare module '@tiptap/core' {
  interface Storage {
    slashCommand: SlashCommandStorage
  }
}

type SlashSuggestionProps = SuggestionProps<SlashCommandItem, SlashCommandItem>

function positionPopup(element: HTMLElement, getRect: SlashSuggestionProps['clientRect']) {
  const rect = getRect?.()
  if (!rect) return
  const virtualEl = { getBoundingClientRect: () => rect }
  computePosition(virtualEl, element, {
    placement: 'bottom-start',
    strategy: 'fixed',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  }).then(({ x, y }) => {
    if (!element.isConnected) return
    element.style.left = `${x}px`
    element.style.top = `${y}px`
  })
}

function renderSlashSuggestion(): ReturnType<NonNullable<SuggestionOptions['render']>> {
  let component: ReactRenderer<SlashCommandListHandle> | null = null
  let popup: HTMLElement | null = null
  let boundEditor: Editor | null = null
  let stopAutoUpdate: (() => void) | null = null

  const teardown = () => {
    stopAutoUpdate?.()
    stopAutoUpdate = null
    boundEditor?.off('destroy', teardown)
    boundEditor = null
    popup?.remove()
    component?.destroy()
    popup = null
    component = null
  }

  return {
    onStart: (props) => {
      teardown()
      component = new ReactRenderer(SlashCommandList, { props, editor: props.editor })
      popup = document.createElement('div')
      popup.className = 'fixed top-0 left-0 z-[var(--z-popover)]'
      popup.appendChild(component.element)
      document.body.appendChild(popup)
      boundEditor = props.editor
      boundEditor.on('destroy', teardown)
      const reference = { getBoundingClientRect: () => props.clientRect?.() ?? new DOMRect() }
      const surface = popup
      stopAutoUpdate = autoUpdate(reference, surface, () =>
        positionPopup(surface, props.clientRect)
      )
    },
    onUpdate: (props) => {
      component?.updateProps(props)
      if (popup) positionPopup(popup, props.clientRect)
    },
    onKeyDown: (props) => {
      if (props.event.isComposing) return false
      if (props.event.key === 'Escape') {
        teardown()
        return true
      }
      return component?.ref?.onKeyDown(props) ?? false
    },
    onExit: teardown,
  }
}

/**
 * Adds the `/` slash-command menu to the editor. Typing `/` at the start of a block — or after
 * whitespace — opens {@link SlashCommandList}; selecting an item runs its block transform.
 */
export const SlashCommand = Extension.create<Record<string, never>, SlashCommandStorage>({
  name: 'slashCommand',

  addStorage() {
    return { insertImage: null }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem, SlashCommandItem>({
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        allow: ({ editor, range }) => {
          if (
            editor.isActive('codeBlock') ||
            editor.isActive('table') ||
            editor.isActive('link') ||
            editor.isActive('code')
          ) {
            return false
          }
          const $from = editor.state.doc.resolve(range.from)
          if ($from.parentOffset === 0) return true
          return /\s/.test($from.parent.textBetween($from.parentOffset - 1, $from.parentOffset))
        },
        items: ({ query }) => filterSlashCommands(query),
        command: ({ editor, range, props }) => {
          const ctx: SlashCommandContext = { editor, range }
          props.run(ctx)
        },
        render: renderSlashSuggestion,
      }),
    ]
  },
})
