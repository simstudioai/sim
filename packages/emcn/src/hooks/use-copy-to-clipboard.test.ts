import { writeTextToClipboard } from '@sim/emcn'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface MockClipboardItem {
  items: Record<string, Blob | Promise<Blob>>
}

describe('writeTextToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes prepared text directly', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await writeTextToClipboard('ready')

    expect(writeText).toHaveBeenCalledWith('ready')
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

  it('writes the immediate fallback when ClipboardItem is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal('ClipboardItem', undefined)
    let resolveText: (value: string) => void = () => undefined
    const text = new Promise<string>((resolve) => {
      resolveText = resolve
    })
    const prepare = vi.fn(() => text)

    const result = writeTextToClipboard({ fallback: 'available now', prepare })

    expect(writeText).toHaveBeenCalledWith('available now')
    expect(prepare).not.toHaveBeenCalled()
    await result
    resolveText('prepared later')
  })
})
