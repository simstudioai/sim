import { describe, expect, test } from 'bun:test'
import { buildPreviewHandshakeScript } from './preview-handshake'

describe('preview handshake script', () => {
  test('announces on load and responds to authenticated parent pings', () => {
    const messages: unknown[] = []
    let onMessage: ((event: { origin: string; source: unknown; data: unknown }) => void) | undefined
    const parent = {
      postMessage(message: unknown) {
        messages.push(message)
      },
    }
    const windowObject = {
      parent,
      addEventListener(
        type: string,
        listener: (event: { origin: string; source: unknown; data: unknown }) => void
      ) {
        if (type === 'message') onMessage = listener
      },
    }
    const script = buildPreviewHandshakeScript({
      channelNonce: 'nonce-123456789012345678901234',
      parentOrigin: 'http://localhost:3000',
    })

    Function('window', script)(windowObject)
    expect(messages).toHaveLength(1)

    onMessage?.({
      origin: 'http://localhost:3000',
      source: parent,
      data: { type: 'sim.preview.ping', nonce: 'nonce-123456789012345678901234' },
    })
    expect(messages).toHaveLength(2)

    onMessage?.({
      origin: 'http://evil.localhost',
      source: parent,
      data: { type: 'sim.preview.ping', nonce: 'nonce-123456789012345678901234' },
    })
    expect(messages).toHaveLength(2)
  })
})
