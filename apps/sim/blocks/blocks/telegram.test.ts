import { describe, expect, it } from 'vitest'
import { TelegramBlock, TelegramV2Block } from '@/blocks/blocks/telegram'

const MEDIA_OPS = [
  { operation: 'telegram_send_photo', key: 'photo', label: 'Photo' },
  { operation: 'telegram_send_video', key: 'video', label: 'Video' },
  { operation: 'telegram_send_audio', key: 'audio', label: 'Audio' },
  { operation: 'telegram_send_animation', key: 'animation', label: 'Animation' },
] as const

const base = { botToken: 'bot-token', chatId: '12345' }

function mapParams(params: Record<string, unknown>) {
  return TelegramBlock.tools.config!.params!({ ...base, ...params }) as Record<string, unknown>
}

const userFile = {
  id: 'f1',
  name: 'pic.jpg',
  url: 'https://storage.example/pic.jpg',
  size: 1024,
  type: 'image/jpeg',
  key: 'execution/ws/wf/ex/pic.jpg',
}

describe('Telegram media params', () => {
  /**
   * These tools POST JSON, and Telegram's media field is a String — a file_id, or an HTTP URL
   * Telegram fetches itself. An uploaded file therefore has to become its https URL; sending
   * the UserFile object would put a JSON object where Telegram requires a string.
   */
  for (const { operation, key, label } of MEDIA_OPS) {
    describe(operation, () => {
      it('sends an uploaded file as its https URL, not as an object', () => {
        const mapped = mapParams({ operation, [`${key}Source`]: userFile })
        expect(mapped[key]).toBe('https://storage.example/pic.jpg')
      })

      it('sends a file reference resolved from advanced mode as its https URL', () => {
        const mapped = mapParams({ operation, [`${key}Source`]: JSON.stringify(userFile) })
        expect(mapped[key]).toBe('https://storage.example/pic.jpg')
      })

      it('reports a clear error when the file has no https URL to fetch', () => {
        expect(() =>
          mapParams({ operation, [`${key}Source`]: { ...userFile, url: '/api/files/serve/local' } })
        ).toThrow(/https URL for Telegram to fetch/)
      })

      it(`throws when no ${key} is supplied`, () => {
        expect(() => mapParams({ operation })).toThrow(`${label} is required.`)
      })
    })
  }
})

/**
 * A tool call (Agent tool row, Pi, Human v2) passes the operation only in the context, and the
 * merged params hold the model's args under the tool's param names next to any block-only values
 * the user stored on the row.
 */
function mapToolCall(operation: string, merged: Record<string, unknown>) {
  const mapper = TelegramV2Block.tools.config?.params
  if (!mapper) throw new Error('Telegram V2 has no params mapper')
  return mapper({ chatId: '12345', ...merged }, { operation }) as Record<string, unknown>
}

describe('Telegram tool-call params', () => {
  it('keeps the model emoji instead of clearing the reaction', () => {
    const mapped = mapToolCall('telegram_set_message_reaction', { messageId: 5, reaction: '👍' })
    expect(mapped.reaction).toBe('👍')
  })

  it('keeps the model poll options and coerces a stored dropdown boolean', () => {
    const mapped = mapToolCall('telegram_send_poll', {
      question: 'Lunch?',
      options: ['Pizza', 'Sushi'],
      isAnonymous: 'false',
    })
    expect(mapped.options).toEqual(['Pizza', 'Sushi'])
    expect(mapped.isAnonymous).toBe(false)
  })

  it('sends poll options the user stored on the tool row', () => {
    const mapped = mapToolCall('telegram_send_poll', {
      question: 'Lunch?',
      pollOptions: 'Pizza\nSushi',
    })
    expect(mapped.options).toBe('Pizza\nSushi')
  })

  it('sends a photo uploaded on the tool row as its https URL', () => {
    const mapped = mapToolCall('telegram_send_photo', { photoSource: userFile })
    expect(mapped.photo).toBe('https://storage.example/pic.jpg')
  })

  it('accepts a numeric chat ID from the model', () => {
    const mapped = mapToolCall('telegram_get_chat', { chatId: -1001234 })
    expect(mapped.chatId).toBe('-1001234')
  })
})
