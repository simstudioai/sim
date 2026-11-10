/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { type ClipboardContent, useCopyToClipboard } from './use-copy-to-clipboard'

interface MockClipboardItem {
  items: Record<string, Blob | Promise<Blob>>
}

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

function mountCopy(): (content: ClipboardContent) => Promise<boolean> {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  let copy: ((content: ClipboardContent) => Promise<boolean>) | null = null
  function Probe() {
    copy = useCopyToClipboard().copy
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(<Probe />))
  if (!copy) throw new Error('useCopyToClipboard did not render')
  return copy
}

describe('useCopyToClipboard', () => {
  it('starts a ClipboardItem write before promised text resolves', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { write, writeText } })
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(readonly items: Record<string, Blob | Promise<Blob>>) {}
      }
    )
    let resolveText: (value: string) => void = () => undefined
    const text = new Promise<string>((resolve) => {
      resolveText = resolve
    })
    const copy = mountCopy()

    const result = copy({ fallback: 'available now', prepare: () => text })

    expect(write).toHaveBeenCalledOnce()
    expect(writeText).not.toHaveBeenCalled()
    const [clipboardItems] = write.mock.calls[0] as [MockClipboardItem[]]
    resolveText('prepared later')
    const blob = await clipboardItems[0].items['text/plain']
    expect(await readBlobText(blob)).toBe('prepared later')
    await act(async () => {
      expect(await result).toBe(true)
    })
  })
})
