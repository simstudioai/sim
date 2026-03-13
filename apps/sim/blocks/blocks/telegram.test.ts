import { describe, expect, it } from 'vitest'
import { TelegramBlock } from '@/blocks/blocks/telegram'

describe('TelegramBlock', () => {
  const paramsFn = TelegramBlock.tools.config?.params

  if (!paramsFn) {
    throw new Error('TelegramBlock.tools.config.params function is missing')
  }

  it.concurrent('accepts a public URL string for telegram_send_photo', () => {
    const result = paramsFn({
      operation: 'telegram_send_photo',
      botToken: 'token',
      chatId: ' 123 ',
      photo: ' https://example.com/a.jpg ',
      caption: 'hello',
    })

    expect(result).toEqual({
      botToken: 'token',
      chatId: '123',
      photo: 'https://example.com/a.jpg',
      caption: 'hello',
    })
  })

  it.concurrent('accepts a file-like object for telegram_send_photo (uses url)', () => {
    const result = paramsFn({
      operation: 'telegram_send_photo',
      botToken: 'token',
      chatId: '123',
      photo: { id: 'f1', url: 'https://example.com/file.png' },
    })

    expect(result).toMatchObject({
      photo: 'https://example.com/file.png',
    })
  })

  it.concurrent('accepts JSON-stringified file objects in advanced mode', () => {
    const result = paramsFn({
      operation: 'telegram_send_photo',
      botToken: 'token',
      chatId: '123',
      photo: JSON.stringify({ id: 'f1', url: 'https://example.com/file.png' }),
    })

    expect(result).toMatchObject({
      photo: 'https://example.com/file.png',
    })
  })

  it.concurrent('throws a user-facing error when photo is missing/blank', () => {
    expect(() =>
      paramsFn({
        operation: 'telegram_send_photo',
        botToken: 'token',
        chatId: '123',
        photo: '   ',
      })
    ).toThrow('Photo is required.')
  })

  it.concurrent('accepts a public URL string for telegram_send_video', () => {
    const result = paramsFn({
      operation: 'telegram_send_video',
      botToken: 'token',
      chatId: '123',
      video: 'https://example.com/v.mp4',
    })

    expect(result).toMatchObject({
      video: 'https://example.com/v.mp4',
    })
  })
})
