/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { TextEditor } from '@/app/workspace/[workspaceId]/files/components/file-viewer/text-editor'

interface MockMonacoProps {
  onChange?: (value: string | undefined) => void
  onMount?: (editor: unknown, monaco: unknown) => void
  options?: unknown
}

const state = vi.hoisted(() => ({
  content: 'initial',
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
      isStreamInteractionLocked: false,
      isContentLoading: false,
      hasContentError: false,
      saveImmediately: vi.fn(),
    }),
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/use-selection-copy-bridge',
  () => ({ useSelectionCopyBridge: vi.fn() })
)

vi.mock('@/hooks/use-add-to-chat', () => ({ useAddToChat: () => vi.fn() }))

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
  }
  const editor = {
    getModel: vi.fn(() => model),
    addCommand: vi.fn(),
    getSelection: vi.fn(() => null),
    onContextMenu: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDispose: vi.fn(),
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

describe('TextEditor content synchronization', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    state.content = 'initial'
    state.editorProps = null
  })

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
})
