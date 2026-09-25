import { writeTextToClipboard } from '@sim/emcn'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface MockClipboardItem {
  items: Record<string, Blob | Promise<Blob>>
}

describe('writeTextToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

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

    const result = writeTextToClipboard({ fallback: 'available now', prepare: () => text })

    expect(write).toHaveBeenCalledOnce()
    expect(writeText).not.toHaveBeenCalled()
    const [clipboardItems] = write.mock.calls[0] as [MockClipboardItem[]]
    resolveText('prepared later')
    const blob = await clipboardItems[0].items['text/plain']
    expect(await blob.text()).toBe('prepared later')
    await result
  })
})
