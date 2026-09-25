import { fileUtilsMock } from '@sim/testing/mocks/file-utils.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/utils/validation', () => ({
  SUPPORTED_CODE_EXTENSIONS: ['js', 'ts', 'py', 'go', 'rs', 'sh', 'sql'],
}))

vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)

import { resolveFileCategory } from './file-category'

describe('resolveFileCategory — MIME priority', () => {
  it('text/plain MIME + .pdf extension → text-editable (MIME wins)', () => {
    expect(resolveFileCategory('text/plain', 'notes.pdf')).toBe('text-editable')
  })

  it('application/pdf MIME + .txt extension → iframe-previewable (MIME wins)', () => {
    expect(resolveFileCategory('application/pdf', 'disguised.txt')).toBe('iframe-previewable')
  })
})
