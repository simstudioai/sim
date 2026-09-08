/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps, createRef, Suspense } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileDownloadSource } from '@/lib/uploads/client/download'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { SIM_PAGE_CONTENT_TYPE } from '@/lib/workspace-files/page-compile'
import { TextEditor } from '@/app/workspace/[workspaceId]/files/components/file-viewer/text-editor'
import { useFileViewerStore } from '@/stores/file-viewer/store'

interface MockMonacoProps {
  onChange?: (value: string | undefined) => void
  onMount?: (editor: unknown, monaco: unknown) => void
  options?: unknown
}

const state = vi.hoisted(() => ({
  content: 'initial',
  streaming: false,
  loading: false,
  error: false,
  editorProps: null as MockMonacoProps | null,
}))

vi.mock('next/dynamic', () => ({
  default: () => (props: MockMonacoProps) => {
    state.editorProps = props
    return <div data-testid='monaco-editor' />
  },
}))

vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/use-editable-file-content',
  () => ({
    useEditableFileContent: () => ({
      content: state.content,
      setDraftContent: (content: string) => {
        state.content = content
      },
      isStreamInteractionLocked: state.streaming,
      isContentLoading: state.loading,
      hasContentError: state.error,
      saveImmediately: vi.fn(),
    }),
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/use-selection-copy-bridge',
  () => ({ useSelectionCopyBridge: vi.fn() })
)

vi.mock('@/hooks/use-add-to-chat', () => ({ useAddToChat: () => vi.fn() }))

vi.mock('@/app/workspace/[workspaceId]/files/components/file-viewer/preview-panel', () => ({
  resolvePreviewType: (_type: string, name: string) => (name.endsWith('.html') ? 'html' : null),
  PreviewPanel: () => <div data-testid='preview' />,
}))

const file: WorkspaceFileRecord = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'example.txt',
  key: 'workspace/file-1',
  path: '/workspace/file-1',
  size: 7,
  type: 'text/plain',
  uploadedBy: 'user-1',
  uploadedAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

const props: ComponentProps<typeof TextEditor> = {
  file,
  workspaceId: file.workspaceId,
  canEdit: true,
  previewMode: 'editor',
  disableStreamingAutoScroll: false,
}

function createEditor() {
  let editorValue = 'initial'
  const getValue = vi.fn(() => editorValue)
  const applyEdits = vi.fn((edits: Array<{ text: string }>) => {
    editorValue = edits[0]?.text ?? editorValue
  })
  const model = {
    getValue,
    setValue: vi.fn((value: string) => {
      editorValue = value
    }),
    applyEdits,
    getFullModelRange: vi.fn(() => ({})),
    getLineCount: vi.fn(() => 10),
    getLineMaxColumn: vi.fn(() => 8),
  }
  const editor = {
    getModel: vi.fn(() => model),
    addCommand: vi.fn(),
    getSelection: vi.fn(() => null),
    onContextMenu: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDispose: vi.fn(),
    onDidScrollChange: vi.fn((_listener: () => void) => ({ dispose: vi.fn() })),
    getScrollTop: vi.fn(() => 900),
    getScrollHeight: vi.fn(() => 1000),
    getLayoutInfo: vi.fn(() => ({ height: 100 })),
    revealLine: vi.fn(),
  }
  const monaco = {
    KeyMod: { CtrlCmd: 1 },
    KeyCode: { KeyS: 2 },
  }

  return { editor, monaco, model, getValue, applyEdits }
}

function renderEditor(): { rerender: () => void; root: Root } {
  const root = createRoot(document.createElement('div'))
  act(() => root.render(<TextEditor {...props} />))
  return {
    rerender: () => act(() => root.render(<TextEditor {...props} file={{ ...file }} />)),
    root,
  }
}

function renderSplitEditor(direction = 'ltr') {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => root.render(<TextEditor {...props} previewMode='split' />))
  const separator = container.querySelector<HTMLDivElement>('[role="separator"]')!
  const surface = container.querySelector<HTMLDivElement>('[data-find-tooltip-fix]')!
  surface.style.direction = direction
  const paneId = separator.getAttribute('aria-controls')!
  const sourcePane = document.getElementById(paneId)!

  return {
    separator,
    surface,
    sourcePane,
    key: (key: string, options: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...options,
      })
      act(() => {
        separator.dispatchEvent(event)
      })
      return event
    },
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe('TextEditor content synchronization', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    state.content = 'initial'
    state.streaming = false
    state.loading = false
    state.error = false
    state.editorProps = null
    useFileViewerStore.getState().reset()
  })

  it('exports the current source draft synchronously without saving and clears it on unmount', () => {
    const downloadSourceRef = createRef<FileDownloadSource | null>()
    const root = createRoot(document.createElement('div'))
    act(() => root.render(<TextEditor {...props} downloadSourceRef={downloadSourceRef} />))
    expect(downloadSourceRef.current).toMatchObject({
      fileId: file.id,
      workspaceId: file.workspaceId,
    })
    expect(downloadSourceRef.current?.getContent()).toBe('initial')
    const draft = '# Source ![image](image.png)\n\n| a | b |\n| - | - |\n'
    act(() => state.editorProps?.onChange?.(draft))
    expect(downloadSourceRef.current?.getContent()).toBe(draft)
    act(() => state.editorProps?.onChange?.(''))
    expect(downloadSourceRef.current?.getContent()).toBe('')
    act(() => root.unmount())
    expect(downloadSourceRef.current).toBeNull()
  })

  it.each(['loading', 'error'] as const)(
    'does not expose unavailable source content: %s',
    (condition) => {
      state[condition] = true
      const downloadSourceRef = createRef<FileDownloadSource | null>()
      const root = createRoot(document.createElement('div'))
      act(() => root.render(<TextEditor {...props} downloadSourceRef={downloadSourceRef} />))
      expect(downloadSourceRef.current).toBeNull()
      state[condition] = false
      act(() =>
        root.render(
          <TextEditor {...props} file={{ ...file }} downloadSourceRef={downloadSourceRef} />
        )
      )
      expect(downloadSourceRef.current?.getContent()).toBe('initial')
      act(() => root.unmount())
    }
  )

  it('shares page recognition with already mounted viewers and keeps it across remounts', () => {
    const pageFile = { ...file, id: 'page-a', name: 'page.html', type: 'text/html' }
    const container = document.createElement('div')
    const root = createRoot(container)
    const render = (recognized: boolean) =>
      act(() =>
        root.render(
          <>
            <TextEditor {...props} file={pageFile} />
            {recognized && (
              <TextEditor {...props} file={{ ...pageFile, type: SIM_PAGE_CONTENT_TYPE }} />
            )}
          </>
        )
      )

    render(false)
    expect(container.querySelectorAll('[data-testid="monaco-editor"]')).toHaveLength(1)
    render(true)
    expect(container.querySelectorAll('[data-testid="monaco-editor"]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-testid="preview"]')).toHaveLength(2)
    act(() => root.unmount())

    const remounted = createRoot(container)
    act(() => remounted.render(<TextEditor {...props} file={pageFile} />))
    expect(container.querySelector('[data-testid="monaco-editor"]')).toBeNull()
    expect(container.querySelector('[data-testid="preview"]')).not.toBeNull()
    act(() => remounted.unmount())
  })

  it('does not remember a page from a render that never commits', () => {
    const pending = new Promise<void>(() => {})
    function Suspend(): never {
      throw pending
    }
    const root = createRoot(document.createElement('div'))
    act(() =>
      root.render(
        <Suspense fallback={<div>Loading</div>}>
          <TextEditor
            {...props}
            file={{ ...file, id: 'abandoned-page', type: SIM_PAGE_CONTENT_TYPE }}
          />
          <Suspend />
        </Suspense>
      )
    )
    expect(useFileViewerStore.getState().pageFileIds.has('abandoned-page')).toBe(false)
    act(() => root.unmount())
  })

  it('exposes a focusable splitter with source-pane values and keyboard resizing', () => {
    const view = renderSplitEditor()
    try {
      expect(view.separator.tabIndex).toBe(0)
      expect(view.separator.getAttribute('aria-orientation')).toBe('vertical')
      expect(view.separator.getAttribute('aria-valuemin')).toBe('20')
      expect(view.separator.getAttribute('aria-valuemax')).toBe('80')
      expect(view.separator.getAttribute('aria-valuenow')).toBe('50')
      expect(
        view.sourcePane.contains(document.querySelector('[data-testid="monaco-editor"]'))
      ).toBe(true)
      act(() => view.separator.focus())
      expect(document.activeElement).toBe(view.separator)
      expect(view.key('ArrowRight').defaultPrevented).toBe(true)
      expect(view.sourcePane.style.width).toBe('55%')
      expect(view.separator.getAttribute('aria-valuenow')).toBe('55')
      expect(view.separator.getAttribute('aria-valuetext')).toBe('55% source, 45% preview')
      view.key('ArrowLeft')
      expect(view.sourcePane.style.width).toBe('50%')
      expect(document.activeElement).toBe(view.separator)
    } finally {
      view.unmount()
    }
  })

  it('uses Home and End and clamps arrow keys to the existing pointer bounds', () => {
    const view = renderSplitEditor()
    try {
      view.key('Home')
      view.key('ArrowLeft')
      expect(view.sourcePane.style.width).toBe('20%')
      expect(view.separator.getAttribute('aria-valuenow')).toBe('20')
      view.key('End')
      view.key('ArrowRight')
      expect(view.sourcePane.style.width).toBe('80%')
      expect(view.separator.getAttribute('aria-valuenow')).toBe('80')
    } finally {
      view.unmount()
    }
  })

  it('does not consume unrelated, modified, or composing keys on the splitter', () => {
    const view = renderSplitEditor()
    try {
      for (const key of ['Tab', 'ArrowUp', 'Enter', 'a']) {
        expect(view.key(key).defaultPrevented).toBe(false)
      }
      for (const options of [
        { ctrlKey: true },
        { metaKey: true },
        { altKey: true },
        { shiftKey: true },
        { isComposing: true },
        { keyCode: 229 },
      ]) {
        expect(view.key('ArrowRight', options).defaultPrevented).toBe(false)
      }
      expect(view.sourcePane.style.width).toBe('50%')
    } finally {
      view.unmount()
    }
  })

  it.each(['ltr', 'rtl'])(
    'keeps keyboard and pointer movement aligned in %s layout',
    (direction) => {
      const view = renderSplitEditor(direction)
      try {
        view.key('ArrowRight')
        expect(view.sourcePane.style.width).toBe(direction === 'rtl' ? '45%' : '55%')
        view.key('ArrowLeft')
        expect(view.sourcePane.style.width).toBe('50%')
        vi.spyOn(view.surface, 'getBoundingClientRect').mockReturnValue(
          new DOMRect(100, 0, 1000, 600)
        )
        act(() => view.separator.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
        act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 800 })))
        expect(view.sourcePane.style.width).toBe(direction === 'rtl' ? '30%' : '70%')
        act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0 })))
        expect(view.sourcePane.style.width).toBe(direction === 'rtl' ? '80%' : '20%')
        act(() => document.dispatchEvent(new MouseEvent('mouseup')))
      } finally {
        view.unmount()
      }
    }
  )

  it('does not reread the complete Monaco model after a local edit', () => {
    const view = renderEditor()
    const { editor, monaco, getValue } = createEditor()

    act(() => {
      state.editorProps?.onMount?.(editor, monaco)
    })
    const initialOptions = state.editorProps?.options
    getValue.mockClear()

    act(() => {
      state.editorProps?.onChange?.('local edit')
    })
    view.rerender()

    expect(getValue).not.toHaveBeenCalled()
    expect(state.editorProps?.options).toBe(initialOptions)
    act(() => view.root.unmount())
  })

  it('attaches scroll tracking when Monaco mounts after the streaming surface', () => {
    state.streaming = true
    const view = renderEditor()
    const { editor, monaco } = createEditor()
    act(() => state.editorProps?.onMount?.(editor, monaco))
    expect(editor.onDidScrollChange).toHaveBeenCalledOnce()
    state.content = 'initial append'
    view.rerender()
    expect(editor.revealLine).toHaveBeenCalled()
    editor.revealLine.mockClear()
    editor.getScrollTop.mockReturnValue(100)
    act(() => editor.onDidScrollChange.mock.calls[0]![0]())
    state.content = 'initial append next'
    view.rerender()
    expect(editor.revealLine).not.toHaveBeenCalled()
    const listener = editor.onDidScrollChange.mock.results[0]!.value
    act(() => view.root.unmount())
    expect(listener.dispose).toHaveBeenCalledOnce()
  })

  it('still reconciles an external update when the editor has no local changes', () => {
    const view = renderEditor()
    const { editor, monaco, getValue, applyEdits } = createEditor()

    act(() => {
      state.editorProps?.onMount?.(editor, monaco)
    })
    getValue.mockClear()

    state.content = 'server update'
    view.rerender()

    expect(getValue).toHaveBeenCalledOnce()
    expect(applyEdits).toHaveBeenCalledWith([{ range: {}, text: 'server update' }])
    act(() => view.root.unmount())
  })

  it('applies a deliberate conflict reload after the editor previously held a local draft', () => {
    const view = renderEditor()
    const { editor, monaco, model, applyEdits } = createEditor()
    act(() => state.editorProps?.onMount?.(editor, monaco))
    model.setValue('local draft')
    act(() => state.editorProps?.onChange?.('local draft'))
    view.rerender()
    state.content = 'reloaded remote'
    view.rerender()
    expect(applyEdits).toHaveBeenCalledWith([{ range: {}, text: 'reloaded remote' }])
    act(() => view.root.unmount())
  })
})
