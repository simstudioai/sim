import type { ForwardRefExoticComponent, PropsWithoutRef, RefAttributes } from 'react'
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'

/** The imperative handle every suggestion list exposes so the popup can forward arrow/enter keys to it. */
export interface SuggestionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

type AnySuggestionProps = SuggestionProps<unknown, unknown>

function positionPopup(element: HTMLElement, getRect: AnySuggestionProps['clientRect']) {
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

interface SuggestionPopupConfig<P, H extends SuggestionListHandle> {
  /** The React list component, mounted via `ReactRenderer` into a detached, floating body element. */
  component: ForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<H>>
  /** Maps the live suggestion props to the list component's props. */
  mapProps: (props: AnySuggestionProps) => P
  /** Called once when the popup opens, before mount — e.g. to lazily start data fetching. */
  onOpen?: (props: AnySuggestionProps) => void
}

/**
 * Builds the `render` lifecycle for a `@tiptap/suggestion` popup: mounts a React list into a fixed,
 * floating-ui-positioned body element, repositions on update/scroll, forwards keys to the list's
 * imperative handle, and tears everything down on exit / Escape / editor-destroy. Shared by the `/`
 * slash command and the `@` mention menu so the popup mechanics live in exactly one place.
 */
export function createSuggestionPopupRenderer<P, H extends SuggestionListHandle>(
  config: SuggestionPopupConfig<P, H>
): NonNullable<SuggestionOptions['render']> {
  return () => {
    let component: ReactRenderer<H> | null = null
    let popup: HTMLElement | null = null
    let boundEditor: AnySuggestionProps['editor'] | null = null
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
        config.onOpen?.(props)
        component = new ReactRenderer(config.component, {
          // ReactRenderer types its props option loosely; the component still enforces P.
          props: config.mapProps(props) as Record<string, unknown>,
          editor: props.editor,
        })
        popup = document.createElement('div')
        popup.className = 'fixed top-0 left-0 z-[var(--z-popover)]'
        popup.appendChild(component.element)
        // Mount inside the host dialog when the editor is in a modal: Radix's scroll-lock blocks wheel
        // events outside the dialog subtree, so a body-level popup can't be scrolled. `position: fixed`
        // keeps it viewport-positioned (the modal centers via flex, no transform) so it isn't clipped.
        const host = props.editor.view.dom.closest('[role="dialog"]') ?? document.body
        host.appendChild(popup)
        boundEditor = props.editor
        boundEditor.on('destroy', teardown)
        const reference = { getBoundingClientRect: () => props.clientRect?.() ?? new DOMRect() }
        const surface = popup
        stopAutoUpdate = autoUpdate(reference, surface, () =>
          positionPopup(surface, props.clientRect)
        )
      },
      onUpdate: (props) => {
        component?.updateProps(config.mapProps(props) as Record<string, unknown>)
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
}
