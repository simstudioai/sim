/** @vitest-environment jsdom */
import { act, Suspense, startTransition } from 'react'
import { toast } from '@sim/emcn'
import { PASTE_RENDER_THRESHOLDS } from '@sim/utils/paste'
import { type Editor, Extension } from '@tiptap/core'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import { ImageUploadPlaceholders } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-upload'
import {
  createRichMarkdownPasteAdmission,
  type RichMarkdownPasteAdmissionOptions,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/paste-admission'
import { LoadedRichMarkdownEditor } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-editor'

const { uploadFile } = vi.hoisted(() => ({ uploadFile: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/auth/auth-client', () => ({ useSession: () => ({ data: null, isPending: false }) }))
vi.mock('@/hooks/queries/workspace-files', () => ({
  useUploadWorkspaceFile: () => ({ mutateAsync: uploadFile }),
}))
vi.mock('@/hooks/use-add-to-chat', () => ({ useAddToChat: () => vi.fn() }))
vi.mock('@/hooks/use-file-content-source', () => ({
  useFileContentSource: () => ({ resolveImageSrc: (src: string) => src }),
}))
vi.mock('@/app/workspace/[workspaceId]/components', () => ({ FindBar: () => null }))
vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/use-editable-file-content',
  () => ({ useEditableFileContent: vi.fn() })
)
vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/use-selection-copy-bridge',
  () => ({ useSelectionCopyBridge: vi.fn() })
)
vi.mock('@/app/workspace/[workspaceId]/files/components/file-viewer/text-editor', () => ({
  TextEditor: () => null,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/editor-extensions',
  () => ({
    createMarkdownEditorExtensions: (options: {
      pasteAdmission?: RichMarkdownPasteAdmissionOptions
    }) => [
      ...createMarkdownContentExtensions(),
      ImageUploadPlaceholders,
      ...(options.pasteAdmission ? [createRichMarkdownPasteAdmission(options.pasteAdmission)] : []),
      Extension.create({ name: 'slashCommand', addStorage: () => ({ insertImage: null }) }),
    ],
  })
)
vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/use-file-doc-collaboration',
  () => ({ useFileDocCollaboration: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/find',
  () => ({ useMarkdownFind: () => ({ isOpen: false }) })
)
vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/mention',
  () => ({ useEditorMentions: vi.fn() })
)
vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/bubble-menu',
  () => ({ EditorBubbleMenu: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/table-menu',
  () => ({ TableBubbleMenu: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/link-hover-card',
  () => ({ LinkHoverCard: () => null })
)

const FILE: WorkspaceFileRecord = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'notes.md',
  type: 'text/markdown',
  key: 'version-1',
  path: '/notes.md',
  size: 30,
  uploadedBy: 'user-1',
  uploadedAt: new Date('2026-09-03T20:00:00Z'),
}
let root: Root
let container: HTMLDivElement
const onChange = vi.fn()
const onEditSource = vi.fn()
const onClientAutosaveChange = vi.fn()
const onSaveShortcut = vi.fn()
const onSuspendedRender = vi.fn()
const pendingRender = new Promise<void>(() => {})

interface SuspendAfterEditorProps {
  active: boolean
}

function SuspendAfterEditor({ active }: SuspendAfterEditorProps) {
  if (active) {
    onSuspendedRender()
    throw pendingRender
  }
  return null
}

interface RenderOptions {
  onChange?: typeof onChange
  onSaveShortcut?: typeof onSaveShortcut
  suspend?: boolean
}

async function render(
  content: string,
  acceptedBaselineContent = content,
  canEdit = true,
  options: RenderOptions = {}
) {
  await act(async () => {
    const update = () =>
      root.render(
        <Suspense fallback='Loading editor'>
          <LoadedRichMarkdownEditor
            file={FILE}
            workspaceId={FILE.workspaceId}
            content={content}
            acceptedBaselineContent={acceptedBaselineContent}
            isStreaming={false}
            canEdit={canEdit}
            userId='user-1'
            userName='User'
            enableFind={false}
            onChange={options.onChange ?? onChange}
            onEditSource={onEditSource}
            onClientAutosaveChange={onClientAutosaveChange}
            onSaveShortcut={options.onSaveShortcut ?? onSaveShortcut}
          />
          <SuspendAfterEditor active={options.suspend ?? false} />
        </Suspense>
      )
    if (options.suspend) startTransition(update)
    else update()
  })
}

function getEditor() {
  const element = container.querySelector<HTMLElement & { editor: Editor }>('.tiptap')
  expect(element).not.toBeNull()
  return element!.editor
}

async function pasteImage(editor: Editor) {
  const image = new File(['image'], 'image.png', { type: 'image/png' })
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { files: [image], items: [], types: ['Files'], getData: () => '' },
  })
  await act(async () => editor.view.dom.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(true)
  expect(uploadFile).toHaveBeenCalledExactlyOnceWith({
    workspaceId: FILE.workspaceId,
    file: image,
    folderId: null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(toast, 'warning').mockReturnValue('test-toast')
  vi.spyOn(toast, 'info').mockReturnValue('uploading-toast')
  vi.spyOn(toast, 'dismiss').mockImplementation(() => {})
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('loaded rich editor lifecycle', () => {
  it.each(['cancel', 'invalidate'] as const)(
    'explains a completed upload without inserting after its anchor is %s',
    async (action) => {
      const pending = Promise.withResolvers<{ file: { url: string } }>()
      uploadFile.mockReturnValueOnce(pending.promise)
      await render('before TARGET after')
      const editor = getEditor()
      await act(async () => editor.commands.setTextSelection({ from: 8, to: 14 }))
      await pasteImage(editor)
      expect(editor.getText()).toBe('before TARGET after')

      await act(async () => {
        if (action === 'cancel') {
          const cancel = editor.view.dom.querySelector<HTMLButtonElement>('button')
          expect(cancel?.textContent).toBe('Cancel insertion')
          cancel!.click()
        } else {
          editor.commands.insertContentAt(10, 'edited')
        }
      })
      const beforeCompletion = editor.getJSON()
      await act(async () => pending.resolve({ file: { url: '/image.png' } }))

      expect(editor.getJSON()).toEqual(beforeCompletion)
      expect(editor.view.dom.querySelector('img')).toBeNull()
      expect(editor.view.dom.querySelector('button')).toBeNull()
      expect(toast.dismiss).toHaveBeenCalledWith('uploading-toast')
      expect(toast.info).toHaveBeenLastCalledWith(
        'The image was uploaded to the workspace but was not inserted.'
      )
    }
  )

  it('inserts a completed upload without reporting cancellation when its anchor survives', async () => {
    const pending = Promise.withResolvers<{ file: { url: string } }>()
    uploadFile.mockReturnValueOnce(pending.promise)
    await render('before TARGET after')
    const editor = getEditor()
    await act(async () => editor.commands.setTextSelection({ from: 8, to: 14 }))
    await pasteImage(editor)
    await act(async () => pending.resolve({ file: { url: '/image.png' } }))

    expect(editor.view.dom.querySelector('img')?.getAttribute('src')).toBe('/image.png')
    expect(editor.getText()).not.toContain('TARGET')
    expect(editor.view.dom.querySelector('button')).toBeNull()
    expect(toast.dismiss).toHaveBeenCalledWith('uploading-toast')
    expect(toast.info).toHaveBeenCalledExactlyOnceWith('Uploading "image.png"…', { duration: 0 })
  })

  it('keeps callbacks and frontmatter tied to the committed editor during a suspended render', async () => {
    const committed = '---\ntitle: committed\n---\n\nbody'
    await render(committed)
    const editor = getEditor()
    const abandonedOnChange = vi.fn()
    const abandonedSave = vi.fn()
    const abandoned = '---\ntitle: abandoned\n---\n\nother body'
    await render(abandoned, abandoned, true, {
      onChange: abandonedOnChange,
      onSaveShortcut: abandonedSave,
      suspend: true,
    })
    expect(onSuspendedRender).toHaveBeenCalled()
    expect(getEditor()).toBe(editor)
    expect(editor.getText()).toBe('body')
    await act(async () => editor.commands.insertContent('edited '))
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('title: committed'))
    expect(onChange.mock.lastCall?.[0]).not.toContain('title: abandoned')
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
    )
    expect(onSaveShortcut).toHaveBeenCalledOnce()
    expect(abandonedOnChange).not.toHaveBeenCalled()
    expect(abandonedSave).not.toHaveBeenCalled()
  })

  it('budgets paste using the latest accepted frontmatter without recreating the editor', async () => {
    await render('---\ntitle: first\n---\n\nbody')
    const editor = getEditor()
    const baseline = `---\ntitle: ${'x'.repeat(1000)}\n---\n\nbody`
    await render(baseline)
    expect(getEditor()).toBe(editor)
    const before = editor.getJSON()
    await act(async () =>
      editor.view.dispatch(
        editor.state.tr
          .insertText('x'.repeat(PASTE_RENDER_THRESHOLDS.ENHANCED_TEXT_CHARACTERS - 500), 1)
          .setMeta('uiEvent', 'paste')
      )
    )
    expect(editor.getJSON()).toEqual(before)
  })

  it('does not steal formatting or composing chords for Save', async () => {
    await render('body')
    for (const extra of [
      { shiftKey: true },
      { altKey: true },
      { isComposing: true },
      { keyCode: 229 },
    ]) {
      getEditor().view.dom.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 's',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
          ...extra,
        })
      )
    }
    expect(onSaveShortcut).not.toHaveBeenCalled()
    getEditor().view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
    )
    expect(onSaveShortcut).toHaveBeenCalledOnce()
  })

  it('uses accepted external frontmatter on the next edit, not the original copy', async () => {
    await render('---\ntitle: first\n---\n\nbody')
    await render('---\ntitle: second\n---\n\nnew body')
    await act(async () => getEditor().commands.insertContent('edited '))
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('title: second'))
    expect(onChange.mock.lastCall?.[0]).not.toContain('title: first')
  })

  it('does not recompute safety from a local serialization echo or overwrite the caret', async () => {
    const baseline = '---\ntitle: first\n---\n\nbody'
    await render(baseline)
    await act(async () => getEditor().commands.insertContent('edited '))
    const selection = getEditor().state.selection.from
    await render(onChange.mock.lastCall![0], baseline)
    expect(getEditor().state.selection.from).toBe(selection)
    expect(getEditor().isEditable).toBe(true)
  })

  it('exposes named multiline textbox semantics and read-only state', async () => {
    await render('body')
    const editable = getEditor().view.dom
    expect(editable.getAttribute('role')).toBe('textbox')
    expect(editable.getAttribute('aria-label')).toBe('notes.md document body')
    expect(editable.getAttribute('aria-multiline')).toBe('true')
    expect(editable.getAttribute('aria-readonly')).toBe('false')
    await render('body', 'body', false)
    expect(editable.getAttribute('aria-readonly')).toBe('true')
    expect(getEditor().isEditable).toBe(false)
  })

  it.each([
    '[unused]: https://example.com',
    '1. [![foo][image]](/dest)\n\n[image]: /url',
    '- [ ] [foo][link]\n\n[link]: /dest',
    '| header |\n| --- |\n| <img src="/image"> |',
  ])('offers source editing without mutating unsupported content: %s', async (content) => {
    await render(content)
    expect(getEditor().isEditable).toBe(false)
    const button = Array.from(container.querySelectorAll('button')).find(
      (node) => node.textContent === 'Edit source'
    )
    expect(button).toBeDefined()
    await act(async () => button!.click())
    expect(onEditSource).toHaveBeenCalledOnce()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('updates editing eligibility and accessibility when an accepted baseline becomes unsupported', async () => {
    await render('body')
    await render('[unused]: https://example.com')
    expect(getEditor().isEditable).toBe(false)
    expect(getEditor().view.dom.getAttribute('aria-readonly')).toBe('true')
    expect(container.textContent).toContain('Edit source')
    await render('restored body')
    expect(getEditor().isEditable).toBe(true)
    expect(getEditor().view.dom.getAttribute('aria-readonly')).toBe('false')
  })
})
