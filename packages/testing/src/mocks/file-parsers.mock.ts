import { vi } from 'vitest'

/** Keys of the real `PARSERS` registry in `@/lib/file-parsers`. */
const SUPPORTED_FILE_EXTENSIONS = new Set([
  'pdf',
  'csv',
  'doc',
  'docx',
  'docm',
  'dotx',
  'txt',
  'md',
  'xlsx',
  'xls',
  'xlsm',
  'xlsb',
  'xltx',
  'ods',
  'pptx',
  'pptm',
  'potx',
  'odt',
  'odp',
  'html',
  'htm',
  'json',
  'jsonl',
  'yaml',
  'yml',
])

/**
 * Controllable mock functions for `@/lib/file-parsers`.
 *
 * `mockParseFile` / `mockParseBuffer` are bare `vi.fn()`. `mockIsSupportedFileType(extension)` is
 * a faithful port: `true` for every extension with a registered parser (case-insensitive).
 *
 * @example
 * ```ts
 * import { fileParsersMockFns } from '@sim/testing/mocks/file-parsers.mock'
 *
 * fileParsersMockFns.mockParseBuffer.mockResolvedValue({ content: 'text', metadata: {} })
 * ```
 */
export const fileParsersMockFns = {
  mockParseFile: vi.fn(),
  mockParseBuffer: vi.fn(),
  mockIsSupportedFileType: vi.fn(
    (extension: string): boolean =>
      typeof extension === 'string' && SUPPORTED_FILE_EXTENSIONS.has(extension.toLowerCase())
  ),
}

/**
 * Static mock module for `@/lib/file-parsers`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/file-parsers', () => fileParsersMock)
 * ```
 */
export const fileParsersMock = {
  parseFile: fileParsersMockFns.mockParseFile,
  parseBuffer: fileParsersMockFns.mockParseBuffer,
  isSupportedFileType: fileParsersMockFns.mockIsSupportedFileType,
}
