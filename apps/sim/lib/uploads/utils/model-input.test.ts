/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  selectModelBoundFileInput,
  selectPreferredModelBoundFileInput,
} from '@/lib/uploads/utils/model-input'

describe('model-bound file input selection', () => {
  it('omits internal storage keys and unrelated file metadata', () => {
    expect(
      selectModelBoundFileInput({
        key: 'effective-key',
        path: 'unused-path',
        url: 'unused-url',
        name: 'unused-name',
        metadata: { secret: 'unused-secret' },
      })
    ).toBeUndefined()
  })

  it('selects an inline payload instead of its unused locator when the route uses base64', () => {
    expect(
      selectModelBoundFileInput(
        {
          base64: 'effective-bytes',
          key: 'unused-key',
          path: 'unused-path',
          type: 'image/png',
          metadata: 'unused-secret',
        },
        { includeInlineBase64: true }
      )
    ).toEqual({ base64: 'effective-bytes' })
  })

  it('mirrors path-first request precedence without selecting the unused upload', () => {
    expect(
      selectPreferredModelBoundFileInput({
        file: { key: 'unused-key', metadata: 'unused-secret' },
        filePath: '  https://example.com/effective.pdf  ',
        prefer: 'path',
      })
    ).toBe('https://example.com/effective.pdf')
  })

  it('mirrors file-first request precedence without selecting the unused path', () => {
    expect(
      selectPreferredModelBoundFileInput({
        file: { key: 'effective-key', metadata: 'unused-secret' },
        filePath: 'https://example.com/unused.pdf',
        prefer: 'file',
      })
    ).toBeUndefined()
  })

  it('keeps only explicitly model-visible attachment metadata', () => {
    expect(
      selectModelBoundFileInput(
        [
          {
            key: 'file-key',
            name: 'report.pdf',
            type: 'application/pdf',
            metadata: 'unused-secret',
          },
        ],
        { includeName: true }
      )
    ).toEqual([{ name: 'report.pdf' }])
  })

  it('normalizes legacy serialized file objects without selecting unrelated metadata', () => {
    expect(
      selectModelBoundFileInput(
        JSON.stringify({
          key: 'effective-key',
          path: 'unused-path',
          metadata: 'unused-secret',
        }),
        { parseSerializedFile: true }
      )
    ).toBeUndefined()

    expect(
      selectModelBoundFileInput('https://example.com/image.png', { parseSerializedFile: true })
    ).toBe('https://example.com/image.png')
  })
})
