/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AttachedFilesList } from '@/app/workspace/[workspaceId]/home/components/user-input/components/attached-files-list/attached-files-list'
import type { AttachedFile } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'

function file(overrides: Partial<AttachedFile>): AttachedFile {
  return {
    id: 'f1',
    name: 'report.pdf',
    size: 1024,
    type: 'application/pdf',
    path: '',
    uploading: false,
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(files: AttachedFile[]) {
  act(() => {
    root.render(
      <AttachedFilesList attachedFiles={files} onFileClick={() => {}} onRemoveFile={() => {}} />
    )
  })
}

describe('AttachedFilesList', () => {
  it('renders a document as a labelled card showing the filename', () => {
    render([file({})])

    expect(container.textContent).toContain('report.pdf')
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders an image with a preview as a thumbnail, not a filename card', () => {
    render([file({ name: 'photo.png', type: 'image/png', previewUrl: 'blob:xyz' })])

    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:xyz')
    expect(container.textContent).not.toContain('photo.png')
  })

  it('keeps a HEIC on the thumbnail shape while it has no preview yet', () => {
    render([file({ name: 'photo.heic', type: 'image/heic' })])

    expect(container.textContent).not.toContain('photo.heic')
    expect(container.querySelector('img')).toBeNull()
  })

  it('caps the card wrapper so a long filename cannot strand the remove badge', () => {
    render([file({ name: '9bacf973-cd64-437b-be12-58be9f2c1a4d-very-long-name.pdf' })])

    // jsdom does no layout, so the cap can only be asserted structurally: it has to sit
    // on the wrapper the badge is positioned against, not on the button.
    const wrapper = container.querySelector('button')?.parentElement
    expect(wrapper?.className).toMatch(/max-w-/)
  })

  it('keeps the remove control visible rather than gating it on hover', () => {
    render([file({})])

    // A reveal-on-hover badge is unreachable on touch and invisible while it holds
    // keyboard focus, so it must not be opacity-gated at all.
    const remove = container.querySelector('button[aria-label^="Remove"]')
    expect(remove).not.toBeNull()
    expect(remove?.className).not.toMatch(/opacity-0/)
  })

  it('drops the image and reveals the type icon when the preview fails to decode', () => {
    render([file({ name: 'photo.heic', type: 'image/heic', previewUrl: '/api/files/serve/x' })])

    const img = container.querySelector('img')
    expect(img).not.toBeNull()

    act(() => {
      img?.dispatchEvent(new Event('error'))
    })

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
