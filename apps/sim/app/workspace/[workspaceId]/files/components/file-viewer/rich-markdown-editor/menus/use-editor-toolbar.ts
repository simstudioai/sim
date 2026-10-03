import {
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react'
import type { PluginKey } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'

interface EditorToolbarOptions {
  editor: Editor
  pluginKey: PluginKey
  canFocus: () => boolean
  /** URL editing uses ordinary form tab order so its native arrow keys do not trap action buttons. */
  roving?: boolean
  onEscape?: () => void
}

function controls(toolbar: HTMLElement): HTMLElement[] {
  return Array.from(
    toolbar.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
  )
}

function makeTabStop(toolbar: HTMLElement, target: HTMLElement): void {
  for (const control of controls(toolbar)) control.tabIndex = control === target ? 0 : -1
}

/** Shared roving focus for the editor's context toolbars; text inputs retain their native editing keys. */
export function useEditorToolbar({
  editor,
  pluginKey,
  canFocus,
  roving = true,
  onEscape,
}: EditorToolbarOptions) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const toolbar = ref.current
    if (!toolbar) return
    const items = controls(toolbar)
    if (!roving) {
      for (const item of items) item.tabIndex = 0
      return
    }
    const target =
      items.find((item) => item === document.activeElement) ??
      items.find((item) => item.tabIndex === 0) ??
      items[0]
    if (target) makeTabStop(toolbar, target)
  })

  useEffect(() => {
    let frame: number | undefined
    const enterToolbar = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== 'F10' ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.isComposing ||
        !editor.isEditable ||
        !canFocus()
      )
        return
      event.preventDefault()
      editor.commands.setMeta(pluginKey, 'show')
      editor.commands.setMeta(pluginKey, 'updatePosition')
      frame = requestAnimationFrame(() => {
        const toolbar = ref.current
        if (!toolbar || editor.isDestroyed || !editor.isEditable || !canFocus()) return
        const items = controls(toolbar)
        const target = items.find((item) => item.tabIndex === 0) ?? items[0]
        target?.focus()
      })
    }
    const dom = editor.view.dom
    dom.addEventListener('keydown', enterToolbar)
    return () => {
      dom.removeEventListener('keydown', enterToolbar)
      if (frame !== undefined) cancelAnimationFrame(frame)
    }
  }, [editor, pluginKey, canFocus])

  const onFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    if (!roving) return
    if (
      event.target instanceof HTMLElement &&
      controls(event.currentTarget).includes(event.target)
    ) {
      makeTabStop(event.currentTarget, event.target)
    }
  }

  /** A permission/stream lock can precede React's render of the hidden toolbar. */
  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (editor.isDestroyed || !editor.isEditable) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return
    if (event.key === 'Escape') {
      if (!event.defaultPrevented) onEscape?.()
      event.preventDefault()
      editor.commands.focus()
      editor.commands.setMeta(pluginKey, 'hide')
      return
    }
    if (!roving || event.target instanceof HTMLInputElement) return
    const items = controls(event.currentTarget)
    const index = items.indexOf(event.target as HTMLElement)
    if (index < 0 || items.length === 0) return
    const direction = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1
    let next: number
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else if (event.key === 'ArrowRight') next = (index + direction + items.length) % items.length
    else if (event.key === 'ArrowLeft') next = (index - direction + items.length) % items.length
    else return
    event.preventDefault()
    items[next]?.focus()
  }

  return { ref, onFocusCapture, onClickCapture, onKeyDown, 'aria-keyshortcuts': 'Alt+F10' }
}
