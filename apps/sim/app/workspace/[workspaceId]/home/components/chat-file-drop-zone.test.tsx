/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SIM_RESOURCE_DRAG_TYPE, SIM_RESOURCES_DRAG_TYPE } from '@/lib/mothership/resource-types'
import { ChatFileDropZone } from '@/app/workspace/[workspaceId]/home/components/chat-file-drop-zone'

vi.mock('@/app/workspace/[workspaceId]/home/components/user-input/components/drop-overlay', () => ({
  DropOverlay: () => <div>Drop files</div>,
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

function render(children: ReactNode) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(children))
}

function findText(text: string) {
  return Array.from(document.querySelectorAll('div')).find(
    (element) => element.childElementCount === 0 && element.textContent === text
  )
}

const screen = {
  queryByText: (text: string) => findText(text) ?? null,
  getByText: (text: string) => {
    const element = findText(text)
    if (!element) throw new Error(`Missing element: ${text}`)
    return element
  },
}

function dispatchDrag(type: string, target: Element, properties: object) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  for (const [name, value] of Object.entries(properties)) {
    Object.defineProperty(event, name, { value })
  }
  act(() => target.dispatchEvent(event))
  return !event.defaultPrevented
}

const fireEvent = {
  dragEnter: (target: Element, properties: object) => dispatchDrag('dragenter', target, properties),
  dragLeave: (target: Element, properties: object) => dispatchDrag('dragleave', target, properties),
  dragOver: (target: Element, properties: object) => dispatchDrag('dragover', target, properties),
  drop: (target: Element, properties: object) => dispatchDrag('drop', target, properties),
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function fileTransfer() {
  return {
    types: ['Files'],
    files: [new File(['image'], 'screenshot.png', { type: 'image/png' })],
    dropEffect: 'none',
  }
}

describe('chat file drop zone', () => {
  it.each(['Conversation', 'Composer'])('attaches files dropped on %s exactly once', (target) => {
    const onFilesDrop = vi.fn()
    const composerDrop = vi.fn()
    render(
      <ChatFileDropZone onFilesDrop={onFilesDrop}>
        <div>Conversation</div>
        <div onDrop={composerDrop}>Composer</div>
      </ChatFileDropZone>
    )
    const dataTransfer = fileTransfer()
    fireEvent.dragEnter(screen.getByText(target), { dataTransfer })
    expect(screen.getByText('Drop files')).toBeTruthy()
    expect(dataTransfer.dropEffect).toBe('copy')
    fireEvent.drop(screen.getByText(target), { dataTransfer })
    expect(onFilesDrop).toHaveBeenCalledExactlyOnceWith(dataTransfer.files)
    expect(composerDrop).not.toHaveBeenCalled()
    expect(screen.queryByText('Drop files')).toBeNull()
  })

  it('keeps the overlay between children and clears it when leaving the panel', () => {
    render(
      <ChatFileDropZone onFilesDrop={vi.fn()}>
        <div>Conversation</div>
        <div>Composer</div>
      </ChatFileDropZone>
    )
    const dataTransfer = fileTransfer()
    fireEvent.dragEnter(screen.getByText('Conversation'), { dataTransfer })
    fireEvent.dragEnter(screen.getByText('Composer'), { dataTransfer })
    fireEvent.dragLeave(screen.getByText('Conversation'), {
      dataTransfer,
      relatedTarget: null,
    })
    expect(screen.getByText('Drop files')).toBeTruthy()
    fireEvent.dragLeave(screen.getByText('Composer'), { dataTransfer, relatedTarget: null })
    expect(screen.queryByText('Drop files')).toBeNull()
  })

  it.each([['text/plain'], [SIM_RESOURCE_DRAG_TYPE, 'Files'], [SIM_RESOURCES_DRAG_TYPE, 'Files']])(
    'leaves non-file and resource drags to their existing handlers: %s',
    (...types) => {
      const onFilesDrop = vi.fn()
      const childDrop = vi.fn()
      render(
        <ChatFileDropZone onFilesDrop={onFilesDrop}>
          <div onDrop={childDrop}>Composer</div>
        </ChatFileDropZone>
      )
      const dataTransfer = { ...fileTransfer(), types }
      fireEvent.dragEnter(screen.getByText('Composer'), { dataTransfer })
      fireEvent.drop(screen.getByText('Composer'), { dataTransfer })
      expect(screen.queryByText('Drop files')).toBeNull()
      expect(onFilesDrop).not.toHaveBeenCalled()
      expect(childDrop).toHaveBeenCalledOnce()
    }
  )

  it('does not claim drops when no composer is available', () => {
    render(
      <ChatFileDropZone>
        <div>Loading chat</div>
      </ChatFileDropZone>
    )
    const dataTransfer = fileTransfer()
    expect(fireEvent.dragOver(screen.getByText('Loading chat'), { dataTransfer })).toBe(true)
    expect(fireEvent.drop(screen.getByText('Loading chat'), { dataTransfer })).toBe(true)
    expect(screen.queryByText('Drop files')).toBeNull()
  })

  it.each(['dragleave', 'drop'])(
    'cleans up %s even if attachments become unavailable during the drag',
    (eventType) => {
      const onFilesDrop = vi.fn()
      const view = (enabled: boolean) => (
        <ChatFileDropZone onFilesDrop={enabled ? onFilesDrop : undefined}>
          <div>Conversation</div>
        </ChatFileDropZone>
      )
      render(view(true))
      fireEvent.dragEnter(screen.getByText('Conversation'), { dataTransfer: fileTransfer() })
      act(() => root?.render(view(false)))
      dispatchDrag(eventType, screen.getByText('Conversation'), { dataTransfer: fileTransfer() })
      act(() => root?.render(view(true)))
      expect(screen.queryByText('Drop files')).toBeNull()
      expect(onFilesDrop).not.toHaveBeenCalled()
    }
  )

  it('clears a cancelled drag when the browser omits file metadata on dragleave', () => {
    render(
      <ChatFileDropZone onFilesDrop={vi.fn()}>
        <div>Conversation</div>
      </ChatFileDropZone>
    )
    fireEvent.dragEnter(screen.getByText('Conversation'), { dataTransfer: fileTransfer() })
    fireEvent.dragLeave(screen.getByText('Conversation'), { dataTransfer: { types: [] } })
    expect(screen.queryByText('Drop files')).toBeNull()
  })

  it('does not claim drops in portaled surfaces or an adjacent resource panel', () => {
    const onFilesDrop = vi.fn()
    render(
      <>
        <ChatFileDropZone onFilesDrop={onFilesDrop}>
          <div>Conversation</div>
          {createPortal(<div>Portaled dialog</div>, document.body)}
        </ChatFileDropZone>
        <div>Resource panel</div>
      </>
    )
    for (const target of ['Portaled dialog', 'Resource panel']) {
      const dataTransfer = fileTransfer()
      expect(fireEvent.dragOver(screen.getByText(target), { dataTransfer })).toBe(true)
      expect(fireEvent.drop(screen.getByText(target), { dataTransfer })).toBe(true)
    }
    expect(onFilesDrop).not.toHaveBeenCalled()
    expect(screen.queryByText('Drop files')).toBeNull()
  })
})
