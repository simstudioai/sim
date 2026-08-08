/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ImagePreview } from '@/components/resources/file-view/components/image-preview/image-preview'
import { ResourceProvider } from '@/components/resources/resource-provider'
import { grantsFromPermissions, workspaceSource } from '@/resources'
import type { FileViewRecord } from '@/resources/file-source'

const SOURCE = workspaceSource({ kind: 'file', workspaceId: 'ws-1', resourceId: 'file-1' })
const GRANTS = grantsFromPermissions({ canRead: true, canEdit: true, canAdmin: false })

const file: FileViewRecord = {
  id: 'file-1',
  name: 'photo.heic',
  key: 'workspace/ws-1/photo.heic',
  size: 1024,
  type: 'image/heic',
  folderId: null,
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

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

function mounted(record: FileViewRecord) {
  return (
    <ResourceProvider source={SOURCE} grants={GRANTS} host='page'>
      <ImagePreview file={record} />
    </ResourceProvider>
  )
}

function render(record: FileViewRecord = file) {
  act(() => root.render(mounted(record)))
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

  it('retries after an overwrite, which mints a new storage key and remounts', () => {
    act(() => root.render(<div key={file.key}>{mounted(file)}</div>))

    act(() => {
      container.querySelector('img')?.dispatchEvent(new Event('error'))
    })
    expect(container.textContent).toContain('Preview not available')

    // Every content write mints a fresh key, so the parent's `key={file.key}`
    // remounts this and the previous bytes' outcome cannot stick.
    const overwritten = { ...file, key: 'workspace/ws-1/photo-v2.heic' }
    act(() => root.render(<div key={overwritten.key}>{mounted(overwritten)}</div>))

    expect(container.querySelector('img')).not.toBeNull()
    expect(container.textContent).not.toContain('Preview not available')
  })
})
