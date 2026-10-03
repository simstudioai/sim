import { describe, expect, it } from 'vitest'
import {
  assertMultiFileUploadAdmission,
  MULTI_FILE_UPLOAD_MAX_FILE_BYTES,
  MULTI_FILE_UPLOAD_MAX_FILES,
  MULTI_FILE_UPLOAD_MAX_TOTAL_BYTES,
  type MultiFileUploadAdmissionError,
} from '@/lib/uploads/client/admission'

function files(count: number, size: number) {
  return Array.from({ length: count }, (_, index) => ({ name: `file-${index}.bin`, size }))
}

describe('multi-file upload admission', () => {
  it('accepts the exact aggregate-byte boundary', () => {
    expect(() =>
      assertMultiFileUploadAdmission(files(5, MULTI_FILE_UPLOAD_MAX_FILE_BYTES))
    ).not.toThrow()
    expect(MULTI_FILE_UPLOAD_MAX_TOTAL_BYTES).toBe(5 * MULTI_FILE_UPLOAD_MAX_FILE_BYTES)
  })

  it('rejects a selection whose combined count exceeds the action cap', () => {
    expect(() =>
      assertMultiFileUploadAdmission([{ name: 'new.bin', size: 1 }], {
        existingFiles: files(MULTI_FILE_UPLOAD_MAX_FILES, 1),
      })
    ).toThrow(
      expect.objectContaining<Partial<MultiFileUploadAdmissionError>>({
        code: 'UPLOAD_FILE_COUNT_EXCEEDED',
      })
    )
  })

  it('rejects one file above the shared per-file ceiling', () => {
    expect(() =>
      assertMultiFileUploadAdmission([
        { name: 'oversized.bin', size: MULTI_FILE_UPLOAD_MAX_FILE_BYTES + 1 },
      ])
    ).toThrow(
      expect.objectContaining<Partial<MultiFileUploadAdmissionError>>({
        code: 'UPLOAD_FILE_SIZE_EXCEEDED',
      })
    )
  })

  it('rejects aggregate bytes across existing and newly selected files', () => {
    expect(() =>
      assertMultiFileUploadAdmission(files(1, MULTI_FILE_UPLOAD_MAX_FILE_BYTES), {
        existingFiles: files(5, MULTI_FILE_UPLOAD_MAX_FILE_BYTES),
      })
    ).toThrow(
      expect.objectContaining<Partial<MultiFileUploadAdmissionError>>({
        code: 'UPLOAD_TOTAL_SIZE_EXCEEDED',
      })
    )
  })

  it('supports a larger direct-to-storage limit without weakening aggregate admission', () => {
    expect(() =>
      assertMultiFileUploadAdmission([{ name: 'archive.zip', size: 1024 }], {
        maxFileBytes: 1024,
        maxTotalBytes: 2048,
      })
    ).not.toThrow()

    expect(() =>
      assertMultiFileUploadAdmission(files(3, 1024), {
        maxFileBytes: 1024,
        maxTotalBytes: 2048,
      })
    ).toThrow(
      expect.objectContaining<Partial<MultiFileUploadAdmissionError>>({
        code: 'UPLOAD_TOTAL_SIZE_EXCEEDED',
      })
    )
  })
})
