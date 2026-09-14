/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatFileDownload } from '@/app/(interfaces)/chat/components/message/components/file-download'
import type { ChatFile } from '@/app/(interfaces)/chat/components/message/message'

const imageFile: ChatFile = {
  id: 'file-image',
  name: 'generated.png',
  key: 'execution/generated.png',
  url: 'https://files.example.com/generated.png',
  size: 3,
  type: 'image/png',
  base64: 'YWJj',
}

const mounts: Array<() => void> = []

function renderFile(file: ChatFile): HTMLDivElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root = createRoot(container)
  act(() => root.render(<ChatFileDownload file={file} />))
  mounts.push(() => act(() => root.unmount()))
  return container
}

afterEach(() => {
  while (mounts.length) mounts.pop()?.()
  vi.restoreAllMocks()
})

describe('ChatFileDownload', () => {
  it('previews returned image bytes inline without requiring a workspace session', () => {
    const container = renderFile(imageFile)
    const image = container.querySelector('img')
    expect(image?.getAttribute('src')).toBe('data:image/png;base64,YWJj')
    expect(image?.alt).toBe('generated.png')
    expect(container.querySelector('button')?.textContent).toContain('generated.png')
  })

  it('uses the file URL when inline bytes are unavailable', () => {
    const container = renderFile({ ...imageFile, base64: undefined })
    expect(container.querySelector('img')?.getAttribute('src')).toBe(imageFile.url)
  })

  it('uses the canonical serve route for unsafe file URLs', () => {
    const container = renderFile({ ...imageFile, base64: undefined, url: 'javascript:alert(1)' })
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/api/files/serve/execution%2Fgenerated.png?context=execution'
    )
  })

  it('keeps a download available when an image preview fails', () => {
    const container = renderFile(imageFile)
    act(() => container.querySelector('img')!.dispatchEvent(new Event('error')))
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('button')?.textContent).toContain('generated.png')
  })

  it('renders documents as downloads without an image preview', () => {
    const container = renderFile({ ...imageFile, name: 'report.pdf', type: 'application/pdf' })
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('button')?.textContent).toContain('report.pdf')
  })
})
