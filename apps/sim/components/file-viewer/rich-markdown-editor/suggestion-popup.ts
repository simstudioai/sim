import type { ForwardRefExoticComponent, PropsWithoutRef, RefAttributes } from 'react'
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'

/** The handle every suggestion list exposes, so the popup can forward arrow and Enter keys to it. */
export interface SuggestionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

/** What the renderer gives every list, beyond the props its extension maps. */
export interface SuggestionPlacement {
  /** The suggestion's range in the document, which the list positions itself against. */
  anchor: { getBoundingClientRect: () => DOMRect }
  /** Closes the list when the reader presses outside it, as Escape does. */
  onDismiss: () => void
}

type AnySuggestionProps = SuggestionProps<unknown, unknown>

interface SuggestionPopupConfig<P extends SuggestionPlacement, H extends SuggestionListHandle> {
  /** The list, which positions and portals its own popup beside the editor. */
  component: ForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<H>>
  mapProps: (props: AnySuggestionProps) => Omit<P, keyof SuggestionPlacement>
  /** Runs once as the popup opens, before mount: to start fetching its data lazily. */
  onOpen?: (props: AnySuggestionProps) => void
}

/**
 * The `render` lifecycle of a `@tiptap/suggestion` popup: mounts the list, keeps its anchor on the
 * suggestion's range, forwards keys to it and tears down on exit, Escape, an outside press or
 * editor destroy.
 */
export function createSuggestionPopupRenderer<
  P extends SuggestionPlacement,
  H extends SuggestionListHandle,
>(config: SuggestionPopupConfig<P, H>): NonNullable<SuggestionOptions['render']> {
  return () => {
    let component: ReactRenderer<H> | null = null
    let boundEditor: AnySuggestionProps['editor'] | null = null

    const teardown = () => {
      boundEditor?.off('destroy', teardown)
      boundEditor = null
      component?.destroy()
      component = null
    }

    const listProps = (props: AnySuggestionProps): Record<string, unknown> => ({
      ...(config.mapProps(props) as Record<string, unknown>),
      anchor: { getBoundingClientRect: () => props.clientRect?.() ?? new DOMRect() },
      onDismiss: teardown,
    })

    return {
      onStart: (props) => {
        teardown()
        if (props.editor.isDestroyed) return
        config.onOpen?.(props)
        component = new ReactRenderer(config.component, {
          props: listProps(props),
          editor: props.editor,
        })
        boundEditor = props.editor
        boundEditor.on('destroy', teardown)
      },
      onUpdate: (props) => {
        component?.updateProps(listProps(props))
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
