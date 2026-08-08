/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  selectModelBoundFileInputPaths,
  selectPreferredModelBoundFileInputPaths,
} from '@/lib/uploads/utils/model-input'

describe('model-bound file input selection', () => {
  it('omits internal storage keys and unrelated file metadata', () => {
    expect(
      selectModelBoundFileInputPaths(
        {
          key: 'effective-key',
          path: 'unused-path',
          url: 'unused-url',
          name: 'unused-name',
          metadata: { secret: 'unused-secret' },
        },
        ['file']
      )
    ).toEqual([])
  })

  it('selects an inline payload instead of its unused locator when the route uses base64', () => {
    expect(
      selectModelBoundFileInputPaths(
        {
          base64: 'effective-bytes',
          key: 'unused-key',
          path: 'unused-path',
          type: 'image/png',
          metadata: 'unused-secret',
        },
        ['file'],
        { includeInlineBase64: true }
      )
    ).toEqual([['file', 'base64']])
  })

  it('mirrors path-first request precedence without selecting the unused upload', () => {
    expect(
      selectPreferredModelBoundFileInputPaths({
        file: { key: 'unused-key', metadata: 'unused-secret' },
        filePath: '  https://example.com/effective.pdf  ',
        fileInputPath: ['file'],
        filePathInputPath: ['filePath'],
        prefer: 'path',
      })
    ).toEqual([['filePath']])
  })

  it('mirrors file-first request precedence without selecting the unused path', () => {
    expect(
      selectPreferredModelBoundFileInputPaths({
        file: { key: 'effective-key', metadata: 'unused-secret' },
        filePath: 'https://example.com/unused.pdf',
        fileInputPath: ['file'],
        filePathInputPath: ['filePath'],
        prefer: 'file',
      })
    ).toEqual([])
  })

  it('keeps only explicitly model-visible attachment metadata', () => {
    expect(
      selectModelBoundFileInputPaths(
        [
          {
            key: 'file-key',
            name: 'report.pdf',
            type: 'application/pdf',
            metadata: 'unused-secret',
          },
        ],
        ['files'],
        { includeName: true }
      )
    ).toEqual([['files', '0', 'name']])
  })

  it('normalizes legacy serialized file objects without selecting unrelated metadata', () => {
    expect(
      selectModelBoundFileInputPaths(
        JSON.stringify({
          key: 'effective-key',
          path: 'unused-path',
          metadata: 'unused-secret',
        }),
        ['file'],
        { parseSerializedFile: true }
      )
    ).toEqual([])

    expect(
      selectModelBoundFileInputPaths('https://example.com/image.png', ['file'], {
        parseSerializedFile: true,
      })
    ).toEqual([['file']])
  })
})
