/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { TelegramBlock } from '@/blocks/blocks/telegram'

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

      it('passes a file_id through untouched', () => {
        const mapped = mapParams({ operation, [key]: '  AgACAgIAAxkBAAI  ' })
        expect(mapped[key]).toBe('AgACAgIAAxkBAAI')
      })

      it('passes a public HTTP URL through untouched', () => {
        const mapped = mapParams({ operation, [key]: 'https://example.com/a.jpg' })
        expect(mapped[key]).toBe('https://example.com/a.jpg')
      })

      it('still accepts a file reference left in the legacy field', () => {
        // Before the upload pair existed this field held either a reference or a string.
        const mapped = mapParams({ operation, [key]: JSON.stringify(userFile) })
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

  it('keeps each media pair to a file upload plus a file reference', () => {
    for (const { key } of MEDIA_OPS) {
      const members = TelegramBlock.subBlocks.filter((s) => s.canonicalParamId === `${key}Source`)
      expect(members.map((s) => s.type)).toEqual(['file-upload', 'short-input'])
      expect(members.map((s) => s.mode)).toEqual(['basic', 'advanced'])
      // The file_id/URL field is deliberately outside the pair.
      const direct = TelegramBlock.subBlocks.find((s) => s.id === key)
      expect(direct?.canonicalParamId).toBeUndefined()
    }
  })
})
