/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { photonImessageSendBodySchema } from '@/lib/api/contracts/tools/communication/messaging'
import { PhotonImessageBlock } from '@/blocks/blocks/photon_imessage'

const credentials = { projectId: 'proj-1', projectSecret: 'secret-1' }

function mapParams(params: Record<string, unknown>) {
  return PhotonImessageBlock.tools.config!.params!({ ...credentials, ...params }) as Record<
    string,
    unknown
  >
}

describe('PhotonImessageBlock params', () => {
  /**
   * A blank optional subblock serializes as '', which would fail the contract's "exactly one
   * target" refinement even though the user only filled the other field in.
   */
  it('drops an empty recipient so an addressed chat ID still validates', () => {
    const mapped = mapParams({ to: '', chatId: 'any;-;+14155551234', text: 'hi' })

    expect(mapped.to).toBeUndefined()
    expect(mapped.chatId).toBe('any;-;+14155551234')
    expect(photonImessageSendBodySchema.safeParse(mapped).success).toBe(true)
  })

  it('drops an empty chat ID so an addressed recipient still validates', () => {
    const mapped = mapParams({ to: '+14155551234', chatId: '', text: 'hi' })

    expect(mapped.chatId).toBeUndefined()
    expect(photonImessageSendBodySchema.safeParse(mapped).success).toBe(true)
  })

  it('rejects a send that names both a recipient and a chat ID', () => {
    const mapped = mapParams({ to: '+14155551234', chatId: 'any;-;+1', text: 'hi' })

    expect(photonImessageSendBodySchema.safeParse(mapped).success).toBe(false)
  })

  it('rejects a send that names no target at all', () => {
    const mapped = mapParams({ to: '', chatId: '', text: 'hi' })

    expect(photonImessageSendBodySchema.safeParse(mapped).success).toBe(false)
  })
})

describe('PhotonImessageBlock wiring', () => {
  it('exposes only the registered send tool', () => {
    expect(PhotonImessageBlock.tools.access).toEqual(['photon_imessage_send_message'])
    expect(PhotonImessageBlock.tools.config!.tool!({})).toBe('photon_imessage_send_message')
  })

  it('advertises the message-received trigger', () => {
    expect(PhotonImessageBlock.triggers?.enabled).toBe(true)
    expect(PhotonImessageBlock.triggers?.available).toEqual(['photon_imessage_message_received'])
  })
})
