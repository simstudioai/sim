/** @vitest-environment jsdom */

import { act, Suspense, startTransition } from 'react'
import { toast } from '@sim/emcn'
import { FILE_DOC_SEED, type JoinFileDocError } from '@sim/realtime-protocol/file-doc'
import { authClientMock } from '@sim/testing/mocks/auth-client.mock'
import { nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { PASTE_LIMITS } from '@sim/utils/paste'
import { type Editor, Extension } from '@tiptap/core'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { exportWorkspaceFileSnapshotBodySchema } from '@/lib/api/contracts/workspace-files'
import type { FileDownloadSource } from '@/lib/uploads/client/download'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import { ImageUploadPlaceholders } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-upload'
import {
  createRichMarkdownPasteAdmission,
  type RichMarkdownPasteAdmissionOptions,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/paste-admission'
import { LoadedRichMarkdownEditor } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-editor'

nextNavigationMockFns.mockUsePathname.mockReturnValue('/workspace/workspace-1/files')

const { collaborationRef, uploadFile } = vi.hoisted(() => ({
  collaborationRef: { current: null as unknown },
  uploadFile: vi.fn(),
}))

vi.mock(
  'next/navigation',
  async () => (await import('@sim/testing/mocks/next-navigation.mock')).nextNavigationMock
)
vi.mock('@/lib/auth/auth-client', () => authClientMock)
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

beforeEach(() => {
  uploadFile.mockReset()
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

  it('captures a local edit synchronously before the parent receives the new content', async () => {
    const downloadSourceRef = { current: null as FileDownloadSource | null }
    await render('Body', 'Body', true, { downloadSourceRef })
    await act(async () => {
      getEditor().commands.insertContentAt(1, 'New ')
      expect(downloadSourceRef.current?.getContent()).toBe('New Body')
    })
  })

  it.each(['plain text', 'heading image'] as const)(
    'exports streamed %s and holds body and metadata during a rewrite',
    async (contentType) => {
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
      const prefix = contentType === 'heading image' ? '# ' : ''
      const suffix = contentType === 'heading image' ? ' ![Logo](/logo.png)' : ''
      const initial = `---\ntitle: Original\n---\n\n${prefix}Original body${suffix}`
      await render(initial, initial, true, { downloadSourceRef })
      const replacement = `---\ntitle: Replacement\n---\n\n${prefix}Replacement body${suffix}`
      await render(replacement, initial, true, { downloadSourceRef, isStreaming: true })
      await tick()
      expect(getEditor().getText().trim()).toBe('Original body')
      expect(downloadSourceRef.current?.getContent()).toBe(initial)
      await render(replacement, replacement, true, { downloadSourceRef })
      expect(getEditor().getText().trim()).toBe('Replacement body')
      if (contentType === 'heading image') {
        expect(getEditor().view.dom.querySelector('h1 img')?.getAttribute('src')).toBe('/logo.png')
      }
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
      expect(getEditor().getText().trim()).toBe('Replacement body')
      expect(downloadSourceRef.current?.getContent()).toBe(replacement)
    }
  )

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
})
