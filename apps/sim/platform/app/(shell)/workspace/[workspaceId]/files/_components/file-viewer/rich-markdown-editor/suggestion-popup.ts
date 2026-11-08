import type { ForwardRefExoticComponent, PropsWithoutRef, RefAttributes } from 'react'
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/suggestion.module.css'

/** The handle every suggestion list exposes, so the popup can forward arrow and Enter keys to it. */
export interface SuggestionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

type AnySuggestionProps = SuggestionProps<unknown, unknown>

const POPUP_OFFSET = 6
const POPUP_PADDING = 8

function positionPopup(element: HTMLElement, getRect: AnySuggestionProps['clientRect']) {
  const rect = getRect?.()
  if (!rect) return
  computePosition({ getBoundingClientRect: () => rect }, element, {
    placement: 'bottom-start',
    strategy: 'fixed',
    middleware: [
      offset(POPUP_OFFSET),
      flip({ padding: POPUP_PADDING }),
      shift({ padding: POPUP_PADDING }),
    ],
  }).then(({ x, y }) => {
    if (!element.isConnected) return
    element.style.left = `${x}px`
    element.style.top = `${y}px`
  })
}

interface SuggestionPopupConfig<P, H extends SuggestionListHandle> {
  /** The list, mounted through `ReactRenderer` into a floating element beside the editor. */
  component: ForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<H>>
  mapProps: (props: AnySuggestionProps) => P
  /** Runs once as the popup opens, before mount: to start fetching its data lazily. */
  onOpen?: (props: AnySuggestionProps) => void
}

/**
 * The `render` lifecycle of a `@tiptap/suggestion` popup: mounts the list into a fixed element
 * inside the editor's Platform surface (so its theme and tokens apply), keeps it beside the caret,
 * forwards keys to the list and tears down on exit, Escape or editor destroy.
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
        if (props.editor.isDestroyed) return
        config.onOpen?.(props)
        component = new ReactRenderer(config.component, {
          props: config.mapProps(props) as Record<string, unknown>,
          editor: props.editor,
        })
        popup = document.createElement('div')
        popup.className = styles.popup
        popup.appendChild(component.element)
        const host = props.editor.view.dom.closest('dialog, [data-emcn]') ?? document.body
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
