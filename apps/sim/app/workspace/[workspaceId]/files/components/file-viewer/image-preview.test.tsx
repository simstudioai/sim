/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { ImagePreview } from './image-preview'

const file = {
  id: 'file-1',
  workspaceId: 'ws-1',
  name: 'photo.heic',
  key: 'workspace/ws-1/photo.heic',
  path: '',
  size: 1024,
  type: 'image/heic',
  uploadedBy: 'user-1',
  folderId: null,
  uploadedAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
} satisfies WorkspaceFileRecord

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // ZoomablePreview measures its content through one; jsdom has no implementation.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render() {
  act(() => root.render(<ImagePreview file={file} />))
}

describe('ImagePreview', () => {
  it('requests the preview derivative rather than the stored bytes', () => {
    render()

    const src = container.querySelector('img')?.getAttribute('src') ?? ''
    expect(src).toContain('preview=1')
    expect(src).not.toContain('raw=1')
  })

  it('falls back to the unsupported state when the image fails to decode', () => {
    render()

    const img = container.querySelector('img')
    expect(img).not.toBeNull()

    act(() => {
      img?.dispatchEvent(new Event('error'))
    })

    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('Preview not available')
  })
})
