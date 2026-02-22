/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { TelegramBlock } from '@/blocks/blocks/telegram'

describe('TelegramBlock tools.config.params', () => {
  it('accepts public photo URLs for telegram_send_photo', () => {
    const params = TelegramBlock.tools.config.params({
      operation: 'telegram_send_photo',
      botToken: 'token',
      chatId: ' 123 ',
      photo: ' https://example.com/a.jpg ',
      caption: 'hello',
    } as any)

    expect(params).toEqual({
      botToken: 'token',
      chatId: '123',
      photo: 'https://example.com/a.jpg',
      caption: 'hello',
    })
  })

  it('accepts stringified JSON photo objects from advanced-mode references', () => {
    const params = TelegramBlock.tools.config.params({
      operation: 'telegram_send_photo',
      botToken: 'token',
      chatId: '123',
      photo: '{"url":"https://example.com/a.jpg"}',
    } as any)

    expect(params.photo).toBe('https://example.com/a.jpg')
  })

  it('supports legacy `withPhoto` alias', () => {
    const params = TelegramBlock.tools.config.params({
      operation: 'telegram_send_photo',
      botToken: 'token',
      chatId: '123',
      withPhoto: 'https://example.com/a.jpg',
    } as any)

    expect(params.photo).toBe('https://example.com/a.jpg')
  })

  it('rejects multiple photo values', () => {
    expect(() =>
      TelegramBlock.tools.config.params({
        operation: 'telegram_send_photo',
        botToken: 'token',
        chatId: '123',
        photo: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
      } as any)
    ).toThrow('Photo reference must be a single item, not an array.')
  })
})
