import type { Editor } from '@tiptap/core'
import { moveDraggedImageNode } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-drag-move'

interface DropOptions {
  html?: string
  copy?: boolean
  beforeDrop?: () => void
}

/** Exercise ProseMirror's drag ownership and drop pipeline, including platform copy modifiers. */
export function dispatchEditorDrop(editor: Editor, position: number, options: DropOptions = {}) {
  const data = new Map<string, string>()
  const transfer = {
    files: [],
    items: [],
    types: [],
    effectAllowed: 'copyMove',
    clearData: () => data.clear(),
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    setDragImage: () => {},
  }
  const event = (type: string) => {
    const result = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: 1,
      clientY: 1,
      altKey: options.copy,
      ctrlKey: options.copy,
    })
    Object.defineProperty(result, 'dataTransfer', { value: transfer })
    return result
  }
  const view = editor.view
  const originalCoords = view.posAtCoords
  const originalHandler = view.props.handleDrop
  view.setProps({ handleDrop: moveDraggedImageNode })
  try {
    if (options.html === undefined) {
      view.posAtCoords = () => ({ pos: view.state.selection.from, inside: -1 })
      view.dispatchEvent(event('dragstart'))
    } else {
      view.dragging = null
      data.set('text/html', options.html)
    }
    options.beforeDrop?.()
    view.posAtCoords = () => ({ pos: position, inside: -1 })
    const drop = event('drop')
    view.dispatchEvent(drop)
    return drop
  } finally {
    view.posAtCoords = originalCoords
    view.setProps({ handleDrop: originalHandler })
  }
}
