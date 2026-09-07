/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EmbeddedFileFolder } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/embedded-file-folder'

const { useFolders, useFiles, state } = vi.hoisted(() => {
  const state = {
    pending: false,
    placeholder: false,
    error: null as Error | null,
    folders: [
      { id: 'parent', name: 'Reports', parentId: null },
      { id: 'child', name: 'Client documents', parentId: 'parent' },
      { id: 'sibling', name: 'Unrelated folder', parentId: null },
    ],
    files: [
      { id: 'document', name: 'Invoice.md', folderId: 'parent' },
      { id: 'other', name: 'Unrelated document', folderId: 'sibling' },
    ],
  }
  return {
    state,
    useFolders: vi.fn(() => ({
      data: state.folders,
      isPending: false,
      isPlaceholderData: false,
      error: null,
      refetch: vi.fn(),
    })),
    useFiles: vi.fn(() => ({
      data: state.files,
      isPending: state.pending,
      isPlaceholderData: state.placeholder,
      error: state.error,
      refetch: vi.fn(),
    })),
  }
})
vi.mock('@/hooks/queries/workspace-file-folders', () => ({ useWorkspaceFileFolders: useFolders }))
vi.mock('@/hooks/queries/workspace-files', () => ({ useWorkspaceFiles: useFiles }))

const render = (folderId = 'parent') =>
  renderToStaticMarkup(
    <EmbeddedFileFolder workspaceId='workspace' folderId={folderId} onOpen={vi.fn()} />
  )

describe('EmbeddedFileFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.pending = false
    state.placeholder = false
    state.error = null
  })

  it('shows direct child folders and files without including siblings', () => {
    const markup = render()
    expect(markup).toContain('Reports')
    expect(markup).toContain('Client documents')
    expect(markup).toContain('Invoice.md')
    expect(markup).not.toContain('Unrelated')
    expect(markup).toContain('Open folder')
    expect(useFolders).toHaveBeenCalledWith('workspace')
    expect(useFiles).toHaveBeenCalledWith('workspace')
  })

  it.each(['pending', 'placeholder'] as const)(
    'does not render an empty or stale folder while files are %s',
    (key) => {
      state[key] = true
      const markup = render()
      expect(markup).toContain('Loading folder')
      expect(markup).not.toContain('Invoice.md')
      expect(markup).not.toContain('This folder is empty')
    }
  )

  it('keeps a failed read distinct from an empty folder', () => {
    state.error = new Error('private diagnostic')
    const markup = render()
    expect(markup).toContain('Unable to load this folder')
    expect(markup).toContain('Try again')
    expect(markup).not.toContain('private diagnostic')
    expect(markup).not.toContain('Invoice.md')
  })

  it('distinguishes an empty existing folder from a missing folder', () => {
    expect(render('child')).toContain('This folder is empty')
    expect(render('missing')).toContain('Folder not found')
  })

  it('opens the exact selected folder or file through normal workspace destinations', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onOpen = vi.fn()
    try {
      act(() =>
        root.render(
          <EmbeddedFileFolder workspaceId='workspace' folderId='parent' onOpen={onOpen} />
        )
      )
      for (const name of ['Open folder', 'Client documents', 'Invoice.md']) {
        const button = Array.from(container.querySelectorAll('button')).find(
          (element) => element.textContent === name
        )
        expect(button).toBeDefined()
        act(() => button!.click())
      }
      expect(onOpen.mock.calls).toEqual([
        ['/workspace/workspace/files?folderId=parent'],
        ['/workspace/workspace/files?folderId=child'],
        ['/workspace/workspace/files/document'],
      ])
    } finally {
      act(() => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    }
  })
})
