/** @vitest-environment jsdom */
import { act, Suspense, startTransition } from 'react'
import { toast } from '@sim/emcn'
import { FILE_DOC_SEED, type JoinFileDocError } from '@sim/realtime-protocol/file-doc'
import { PASTE_LIMITS, PASTE_RENDER_THRESHOLDS } from '@sim/utils/paste'
import { type Editor, Extension } from '@tiptap/core'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { exportWorkspaceFileSnapshotBodySchema } from '@/lib/api/contracts/workspace-files'
import { SIM_SELECTION_MIME } from '@/lib/copilot/chat/selection-clipboard'
import type { FileDownloadSource } from '@/lib/uploads/client/download'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { useFileDocCollaboration } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/use-file-doc-collaboration'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import { ImageUploadPlaceholders } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-upload'
import {
  createRichMarkdownPasteAdmission,
  type RichMarkdownPasteAdmissionOptions,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/paste-admission'
import { LoadedRichMarkdownEditor } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-editor'

const { collaborationRef, uploadFile } = vi.hoisted(() => ({
  collaborationRef: { current: null as unknown },
  uploadFile: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace/workspace-1/files',
  useRouter: () => ({ push: vi.fn() }),
}))
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
  () => ({ useFileDocCollaboration: vi.fn(() => collaborationRef.current) })
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
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/image-menu',
  () => ({ ImageBubbleMenu: () => null })
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

class FakeFileDocProvider {
  synced = false
  joinError: JoinFileDocError | null = null
  private readonly listeners = new Map<string, Set<(value: unknown) => void>>()

  on(event: string, listener: (value: unknown) => void) {
    let eventListeners = this.listeners.get(event)
    if (!eventListeners) {
      eventListeners = new Set()
      this.listeners.set(event, eventListeners)
    }
    eventListeners.add(listener)
  }

  off(event: string, listener: (value: unknown) => void) {
    this.listeners.get(event)?.delete(listener)
  }

  setSynced(synced: boolean) {
    this.synced = synced
    for (const listener of this.listeners.get('synced') ?? []) listener(synced)
  }

  fail(error: JoinFileDocError) {
    this.joinError = error
    this.synced = false
    for (const listener of this.listeners.get('join-error') ?? []) listener(error)
  }
}

interface RenderOptions {
  collaborative?: boolean
  downloadSourceRef?: { current: FileDownloadSource | null }
  isStreaming?: boolean
  streamIsIncremental?: boolean
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
            isStreaming={options.isStreaming ?? false}
            streamIsIncremental={options.streamIsIncremental}
            canEdit={canEdit}
            userId='user-1'
            userName='User'
            collaborative={options.collaborative}
            enableFind={false}
            onChange={options.onChange ?? onChange}
            onEditSource={onEditSource}
            onClientAutosaveChange={onClientAutosaveChange}
            onSaveShortcut={options.onSaveShortcut ?? onSaveShortcut}
            downloadSourceRef={options.downloadSourceRef}
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
  collaborationRef.current = null
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
  it('captures immediate collaborative edits with current shared frontmatter without saving', async () => {
    const provider = new FakeFileDocProvider()
    const doc = new Y.Doc()
    const config = doc.getMap(FILE_DOC_SEED.configMap)
    config.set(FILE_DOC_SEED.flag, true)
    const frontmatter = '---\r\n# Metadata\r\ntitle: Updated\r\n---\r\n\r\n'
    config.set(FILE_DOC_SEED.frontmatterKey, frontmatter)
    collaborationRef.current = {
      doc,
      awareness: new Awareness(doc),
      provider,
      user: { name: 'User', color: '#000000', clientId: doc.clientID },
    }
    const downloadSourceRef = { current: null as FileDownloadSource | null }
    await render('stale storage', 'stale storage', true, {
      collaborative: true,
      downloadSourceRef,
    })
    await act(async () => provider.setSynced(true))
    const editor = getEditor()
    await act(async () => {
      editor.commands.setContent('<p>Visible peer text</p>')
      editor.commands.insertContentAt(1, 'Latest local text. ')
      expect(downloadSourceRef.current?.getContent()).toBe(
        `${frontmatter}Latest local text. Visible peer text`
      )
    })
    expect(downloadSourceRef.current).toMatchObject({
      fileId: FILE.id,
      workspaceId: FILE.workspaceId,
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(onSaveShortcut).not.toHaveBeenCalled()
    await act(async () => provider.setSynced(false))
    expect(downloadSourceRef.current?.getContent()).toContain(
      'Latest local text. Visible peer text'
    )
    const oversizedFrontmatter = `---\npadding: ${'x'.repeat(PASTE_LIMITS.RICH_MARKDOWN_BYTES)}\n---\n\n`
    await act(async () => config.set(FILE_DOC_SEED.frontmatterKey, oversizedFrontmatter))
    const snapshot = downloadSourceRef.current?.getContent()
    expect(snapshot).toContain('Latest local text. Visible peer text')
    expect(exportWorkspaceFileSnapshotBodySchema.safeParse({ content: snapshot }).success).toBe(
      false
    )
  })

  it('exports the frozen visible preview before sync, then switches to the live document', async () => {
    const provider = new FakeFileDocProvider()
    const doc = new Y.Doc()
    collaborationRef.current = {
      doc,
      awareness: new Awareness(doc),
      provider,
      user: { name: 'User', color: '#000000', clientId: doc.clientID },
    }
    const downloadSourceRef = { current: null as FileDownloadSource | null }
    const initial = '---\ntitle: Opening\n---\n\nVisible preview'
    await render(initial, initial, true, { collaborative: true, downloadSourceRef })
    await render('newer fetch', 'newer fetch', true, { collaborative: true, downloadSourceRef })
    const hiddenEditor = container.querySelector<HTMLElement & { editor: Editor }>(
      '.hidden .tiptap'
    )!.editor
    await act(async () => hiddenEditor.commands.setContent('<p>Hidden seed</p>'))
    expect(downloadSourceRef.current?.getContent()).toBe(initial)
    await act(async () => {
      doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
      doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.frontmatterKey, '')
      provider.setSynced(true)
    })
    expect(downloadSourceRef.current?.getContent()).toBe('Hidden seed')
  })

  it('preserves unsupported read-only source exactly and releases its download source on unmount', async () => {
    const source = '<img src="/image.png" class="hero" />\n\nBody\n'
    const downloadSourceRef = { current: null as FileDownloadSource | null }
    await render(source, source, true, { downloadSourceRef })
    expect(getEditor().isEditable).toBe(false)
    expect(downloadSourceRef.current?.getContent()).toBe(source)
    await act(async () => root.render(null))
    expect(downloadSourceRef.current).toBeNull()
  })

  it('captures a local edit synchronously before the parent receives the new content', async () => {
    const downloadSourceRef = { current: null as FileDownloadSource | null }
    await render('Body', 'Body', true, { downloadSourceRef })
    await act(async () => {
      getEditor().commands.insertContentAt(1, 'New ')
      expect(downloadSourceRef.current?.getContent()).toBe('New Body')
    })
  })

  it('keeps oversized read-only sources on stored export until a supported baseline is accepted', async () => {
    const source = 'x'.repeat(PASTE_LIMITS.RICH_MARKDOWN_BYTES + 1)
    const downloadSourceRef = { current: null as FileDownloadSource | null }
    await render(source, source, false, { downloadSourceRef })
    expect(getEditor().isEditable).toBe(false)
    expect(downloadSourceRef.current).toBeNull()
    await render('smaller accepted source', 'smaller accepted source', true, { downloadSourceRef })
    expect(downloadSourceRef.current?.getContent()).toBe('smaller accepted source')
  })

  it('exports the displayed streaming frame and holds both body and metadata during a rewrite', async () => {
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrameId = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = ++nextFrameId
      frames.set(id, callback)
      return id
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => frames.delete(id))
    const tick = async () => {
      const pending = [...frames.values()]
      frames.clear()
      await act(async () => {
        for (const callback of pending) callback(0)
      })
    }
    const downloadSourceRef = { current: null as FileDownloadSource | null }
    const initial = '---\ntitle: Original\n---\n\nOriginal body'
    await render(initial, initial, true, { downloadSourceRef })
    const replacement = '---\ntitle: Replacement\n---\n\nReplacement body'
    await render(replacement, initial, true, { downloadSourceRef, isStreaming: true })
    await tick()
    expect(getEditor().getText()).toBe('Original body')
    expect(downloadSourceRef.current?.getContent()).toBe(initial)
    await render(replacement, replacement, true, { downloadSourceRef })
    expect(getEditor().getText()).toBe('Replacement body')
    expect(downloadSourceRef.current?.getContent()).toBe(replacement)
    const appended = `${replacement} and more`
    await render(appended, replacement, true, {
      downloadSourceRef,
      isStreaming: true,
      streamIsIncremental: true,
    })
    expect(downloadSourceRef.current?.getContent()).toBe(replacement)
    await tick()
    expect(downloadSourceRef.current?.getContent()).toBe(appended)

    await act(async () => root.render(null))
    await render(initial, initial, true, { downloadSourceRef, isStreaming: true })
    expect(downloadSourceRef.current?.getContent()).toBeNull()
    await render(replacement, initial, true, { downloadSourceRef, isStreaming: true })
    await tick()
    expect(getEditor().getText()).toBe('Replacement body')
    expect(downloadSourceRef.current?.getContent()).toBe(replacement)
  })

  it.each(['connecting', 'timeout', 'fatal'] as const)(
    'copies selection context from the visible %s preview and switches to the live editor on sync',
    async (status) => {
      const provider = new FakeFileDocProvider()
      const doc = new Y.Doc()
      collaborationRef.current = {
        doc,
        awareness: new Awareness(doc),
        provider,
        user: { name: 'User', color: '#000000', clientId: doc.clientID },
      }
      await render('stored preview body', 'stored preview body', true, { collaborative: true })
      if (status !== 'connecting') {
        await act(async () =>
          provider.fail({
            fileId: FILE.id,
            error: status,
            code: status === 'timeout' ? 'READINESS_TIMEOUT' : 'ACCESS_DENIED',
            retryable: status === 'timeout',
          })
        )
      }

      const preview = getEditor()
      expect(preview.view.dom.getAttribute('aria-label')).toBe('Document preview')
      expect(preview.isEditable).toBe(false)
      const hiddenEditor = container.querySelector<HTMLElement & { editor: Editor }>(
        '.hidden .tiptap'
      )!.editor
      await act(async () => {
        hiddenEditor.commands.setContent('<p>stale hidden selection</p>')
        hiddenEditor.commands.setTextSelection({ from: 1, to: 6 })
        preview.commands.setTextSelection({ from: 1, to: 7 })
      })

      const copy = (editor: Editor) => {
        const written: Record<string, string> = {}
        const event = new Event('copy', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'clipboardData', {
          value: {
            clearData: () => {
              for (const key of Object.keys(written)) delete written[key]
            },
            setData: (type: string, value: string) => {
              written[type] = value
            },
          },
        })
        editor.view.dom.dispatchEvent(event)
        return written
      }
      const previewCopy = copy(preview)
      expect(previewCopy['text/plain']).toBe('stored')
      expect(previewCopy[SIM_SELECTION_MIME]).toBeDefined()
      expect(JSON.parse(previewCopy[SIM_SELECTION_MIME])).toMatchObject({
        sourceWorkspaceId: FILE.workspaceId,
        context: { kind: 'file_selection', fileId: FILE.id, fileName: FILE.name, text: 'stored' },
      })
      expect(doc.getXmlFragment('default').length).toBe(0)
      await act(async () => preview.commands.setTextSelection(1))
      expect(copy(preview)[SIM_SELECTION_MIME]).toBeUndefined()

      await act(async () => {
        provider.joinError = null
        doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
        provider.setSynced(true)
      })
      const editor = getEditor()
      expect(editor).not.toBe(preview)
      expect(container.querySelector('[aria-label="Document preview"]')).toBeNull()
      await act(async () => {
        editor.commands.setContent('<p>live content</p>')
        editor.commands.setTextSelection({ from: 1, to: 5 })
      })
      const liveCopy = copy(editor)
      expect(liveCopy['text/plain']).toBe('live')
      expect(JSON.parse(liveCopy[SIM_SELECTION_MIME])).toMatchObject({
        context: { fileId: FILE.id, text: 'live' },
      })
    }
  )

  it('pauses editing while reconnecting and resumes after the document resyncs', async () => {
    const provider = new FakeFileDocProvider()
    const doc = new Y.Doc()
    doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
    collaborationRef.current = {
      doc,
      awareness: new Awareness(doc),
      provider,
      user: { name: 'User', color: '#000000', clientId: doc.clientID },
    }
    await render('body', 'body', true, { collaborative: true })

    await act(async () => provider.setSynced(true))
    const editor = getEditor()
    expect(editor.isEditable).toBe(true)

    await act(async () => editor.commands.insertContent('local change '))
    await act(async () => provider.setSynced(false))

    expect(editor.isEditable).toBe(false)
    expect(editor.view.dom.getAttribute('aria-readonly')).toBe('true')
    expect(editor.getText()).toContain('local change')
    expect(container.textContent).toContain('Reconnecting…')
    expect(editor.view.dom.closest('.hidden')).toBeNull()

    await act(async () => provider.setSynced(true))

    expect(editor.isEditable).toBe(true)
    expect(editor.view.dom.getAttribute('aria-readonly')).toBe('false')
    expect(container.textContent).not.toContain('Reconnecting…')
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('keeps revoked pending edits visible and read-only without draft-management prompts', async () => {
    const provider = new FakeFileDocProvider()
    const doc = new Y.Doc()
    doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
    collaborationRef.current = {
      doc,
      awareness: new Awareness(doc),
      provider,
      user: { name: 'User', color: '#000000', clientId: doc.clientID },
    }
    await render('stale opening snapshot', 'stale opening snapshot', true, { collaborative: true })

    await act(async () => provider.setSynced(true))
    const editor = getEditor()
    await act(async () => editor.commands.insertContent('live local change'))

    await act(async () =>
      provider.fail({
        fileId: 'file-1',
        error: 'Access denied',
        code: 'ACCESS_REVOKED',
        retryable: false,
      })
    )

    expect(editor.isEditable).toBe(false)
    expect(editor.view.dom.getAttribute('aria-readonly')).toBe('true')
    expect(editor.getText()).toContain('live local change')
    expect(editor.view.dom.closest('.hidden')).toBeNull()
    expect(container.textContent).not.toContain('stale opening snapshot')
    expect(container.textContent).not.toContain('Reconnecting…')
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'You no longer have edit access to this document.'
    )
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('[role="alert"], [role="dialog"]')).toBeNull()
    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('shows stored content read-only when collaboration fails before the first sync', async () => {
    const provider = new FakeFileDocProvider()
    const doc = new Y.Doc()
    collaborationRef.current = {
      doc,
      awareness: new Awareness(doc),
      provider,
      user: { name: 'User', color: '#000000', clientId: doc.clientID },
    }
    await render('stored body', 'stored body', true, { collaborative: true })

    await act(async () =>
      provider.fail({
        fileId: 'file-1',
        error: 'Access denied',
        code: 'ACCESS_DENIED',
        retryable: false,
      })
    )

    const editor = getEditor()
    expect(editor.isEditable).toBe(false)
    expect(editor.view.dom.getAttribute('aria-readonly')).toBe('true')
    expect(editor.getText()).toContain('stored body')
    expect(editor.view.dom.closest('.hidden')).toBeNull()
    expect(container.textContent).not.toContain('Reconnecting…')
  })

  it('keeps timeout preview separate from the authoritative document and recovers on late sync', async () => {
    const provider = new FakeFileDocProvider()
    const doc = new Y.Doc()
    collaborationRef.current = {
      doc,
      awareness: new Awareness(doc),
      provider,
      user: { name: 'User', color: '#000000', clientId: doc.clientID },
    }
    await render('stored preview body', 'stored preview body', true, { collaborative: true })
    await act(async () =>
      provider.fail({
        fileId: 'file-1',
        error: 'Not ready',
        code: 'READINESS_TIMEOUT',
        retryable: true,
      })
    )
    expect(container.textContent).toContain('stored preview body')
    expect(container.textContent).toContain('Reconnecting…')
    expect(doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.flag)).toBeUndefined()
    expect(doc.getXmlFragment('default').length).toBe(0)
    const editors = [...container.querySelectorAll('.tiptap')].map(
      (element) => (element as HTMLElement & { editor: Editor }).editor
    )
    expect(editors.every((editor) => !editor.isEditable)).toBe(true)
    await act(async () => {
      provider.joinError = null
      doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
      provider.setSynced(true)
    })
    expect(container.textContent).not.toContain('stored preview body')
    expect(container.textContent).not.toContain('Reconnecting…')
    expect(getEditor().isEditable).toBe(true)
    expect(onClientAutosaveChange).not.toHaveBeenCalledWith(true)
  })

  it.each(['DOCUMENT_REPLACED', 'PENDING_UPDATE_LIMIT', 'INVALID_UPDATE'])(
    'preserves pending edits with only a passive status for %s',
    async (code) => {
      const provider = new FakeFileDocProvider()
      const doc = new Y.Doc()
      doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
      collaborationRef.current = {
        doc,
        awareness: new Awareness(doc),
        provider,
        user: { name: 'User', color: '#000000', clientId: doc.clientID },
      }
      await render('stored body', 'stored body', true, { collaborative: true })

      await act(async () => provider.setSynced(true))
      await act(async () => getEditor().commands.insertContent('preserved local change'))
      await act(async () =>
        provider.fail({
          fileId: 'file-1',
          error: 'Local recovery required',
          code,
          retryable: false,
        })
      )

      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        'Live editing is unavailable.'
      )
      expect(container.querySelector('button')).toBeNull()
      expect(container.querySelector('[role="alert"], [role="dialog"]')).toBeNull()
      expect(container.textContent).not.toContain('Reconnecting…')
      expect(toast.warning).not.toHaveBeenCalled()
      expect(toast.info).not.toHaveBeenCalled()
      expect(getEditor().isEditable).toBe(false)
      expect(getEditor().getText()).toContain('preserved local change')
    }
  )

  it('explains a picker selection whose insertion anchor was invalidated', async () => {
    await render('before TARGET after')
    const editor = getEditor()
    await act(async () => {
      editor.commands.setTextSelection({ from: 8, to: 14 })
      editor.storage.slashCommand.insertImage?.(8)
      editor.commands.insertContentAt({ from: 7, to: 15 }, 'changed')
    })
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', {
      value: [new File(['image'], 'image.png', { type: 'image/png' })],
    })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    expect(uploadFile).not.toHaveBeenCalled()
    expect(toast.info).toHaveBeenLastCalledWith(
      'The insertion location changed. Choose a new location and select the image again.'
    )
    expect(editor.getText()).toContain('changed')
    expect(input.value).toBe('')
  })

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
    const downloadSourceRef = { current: null as FileDownloadSource | null }
    await render(committed, committed, true, { downloadSourceRef })
    const editor = getEditor()
    const abandonedOnChange = vi.fn()
    const abandonedSave = vi.fn()
    const abandoned = '---\ntitle: abandoned\n---\n\nother body'
    await render(abandoned, abandoned, true, {
      onChange: abandonedOnChange,
      onSaveShortcut: abandonedSave,
      downloadSourceRef,
      suspend: true,
    })
    expect(onSuspendedRender).toHaveBeenCalled()
    expect(getEditor()).toBe(editor)
    expect(editor.getText()).toBe('body')
    expect(downloadSourceRef.current?.getContent()).toBe(committed)
    await act(async () => editor.commands.insertContent('edited '))
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('title: committed'))
    expect(onChange.mock.lastCall?.[0]).not.toContain('title: abandoned')
    expect(downloadSourceRef.current?.getContent()).toBe(onChange.mock.lastCall?.[0])
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
    '# Before ![Image](/image.png) after',
    '| Header |\n| --- |\n| Before ![Image](/image.png) after |',
    '| Before ![Image](/image.png) after |\n| --- |\n| Cell |',
  ])('offers source editing without mutating unsupported content: %s', async (content) => {
    const downloadSourceRef = { current: null as FileDownloadSource | null }
    await render(content, content, true, { collaborative: true, downloadSourceRef })
    expect(useFileDocCollaboration).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    )
    expect(getEditor().isEditable).toBe(false)
    expect(downloadSourceRef.current?.getContent()).toBe(content)
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
