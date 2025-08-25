import { describe, expect, it } from 'vitest'
import { extractFilename } from './utils'

describe('extractFilename', () => {
  describe('legitimate file paths', () => {
    it.concurrent('should extract filename from standard serve path', () => {
      expect(extractFilename('/api/files/serve/test-file.txt')).toBe('test-file.txt')
    })

    it.concurrent('should extract filename from serve path with special characters', () => {
      expect(extractFilename('/api/files/serve/document-with-dashes_and_underscores.pdf')).toBe(
        'document-with-dashes_and_underscores.pdf'
      )
    })

    it.concurrent('should handle simple filename without serve path', () => {
      expect(extractFilename('simple-file.txt')).toBe('simple-file.txt')
    })

    it.concurrent('should extract last segment from nested path', () => {
      expect(extractFilename('nested/path/file.txt')).toBe('file.txt')
    })
  })

  describe('cloud storage paths', () => {
    it.concurrent('should preserve S3 path structure', () => {
      expect(extractFilename('/api/files/serve/s3/1234567890-test-file.txt')).toBe(
        's3/1234567890-test-file.txt'
      )
    })

    it.concurrent('should preserve S3 path with nested folders', () => {
      expect(extractFilename('/api/files/serve/s3/folder/subfolder/document.pdf')).toBe(
        's3/folder/subfolder/document.pdf'
      )
    })

    it.concurrent('should preserve Azure Blob path structure', () => {
      expect(extractFilename('/api/files/serve/blob/1234567890-test-document.pdf')).toBe(
        'blob/1234567890-test-document.pdf'
      )
    })

    it.concurrent('should preserve Blob path with nested folders', () => {
      expect(extractFilename('/api/files/serve/blob/uploads/user-files/report.xlsx')).toBe(
        'blob/uploads/user-files/report.xlsx'
      )
    })
  })

  describe('security - path traversal prevention', () => {
    it.concurrent('should sanitize basic path traversal attempt', () => {
      expect(extractFilename('/api/files/serve/../config.txt')).toBe('config.txt')
    })

    it.concurrent('should sanitize deep path traversal attempt', () => {
      expect(extractFilename('/api/files/serve/../../../../../etc/passwd')).toBe('etcpasswd')
    })

    it.concurrent('should sanitize multiple path traversal patterns', () => {
      expect(extractFilename('/api/files/serve/../../secret.txt')).toBe('secret.txt')
    })

    it.concurrent('should sanitize path traversal with forward slashes', () => {
      expect(extractFilename('/api/files/serve/../../../system/file')).toBe('systemfile')
    })

    it.concurrent('should sanitize mixed path traversal patterns', () => {
      expect(extractFilename('/api/files/serve/../folder/../file.txt')).toBe('folderfile.txt')
    })

    it.concurrent('should remove directory separators from local filenames', () => {
      expect(extractFilename('/api/files/serve/folder/with/separators.txt')).toBe(
        'folderwithseparators.txt'
      )
    })

    it.concurrent('should handle backslash path separators (Windows style)', () => {
      expect(extractFilename('/api/files/serve/folder\\file.txt')).toBe('folderfile.txt')
    })
  })

  describe('cloud storage path traversal prevention', () => {
    it.concurrent('should sanitize S3 path traversal attempts while preserving structure', () => {
      expect(extractFilename('/api/files/serve/s3/../config')).toBe('s3/config')
    })

    it.concurrent('should sanitize S3 path with nested traversal attempts', () => {
      expect(extractFilename('/api/files/serve/s3/folder/../sensitive/../file.txt')).toBe(
        's3/folder/sensitive/file.txt'
      )
    })

    it.concurrent('should sanitize Blob path traversal attempts while preserving structure', () => {
      expect(extractFilename('/api/files/serve/blob/../system.txt')).toBe('blob/system.txt')
    })

    it.concurrent('should remove leading dots from cloud path segments', () => {
      expect(extractFilename('/api/files/serve/s3/.hidden/../file.txt')).toBe('s3/hidden/file.txt')
    })
  })

  describe('edge cases and error handling', () => {
    it.concurrent('should handle filename with dots (but not traversal)', () => {
      expect(extractFilename('/api/files/serve/file.with.dots.txt')).toBe('file.with.dots.txt')
    })

    it.concurrent('should handle filename with multiple extensions', () => {
      expect(extractFilename('/api/files/serve/archive.tar.gz')).toBe('archive.tar.gz')
    })

    it.concurrent('should throw error for empty filename after sanitization', () => {
      expect(() => extractFilename('/api/files/serve/')).toThrow(
        'Invalid or empty filename after sanitization'
      )
    })

    it.concurrent(
      'should throw error for filename that becomes empty after path traversal removal',
      () => {
        expect(() => extractFilename('/api/files/serve/../..')).toThrow(
          'Invalid or empty filename after sanitization'
        )
      }
    )

    it.concurrent('should handle single character filenames', () => {
      expect(extractFilename('/api/files/serve/a')).toBe('a')
    })

    it.concurrent('should handle numeric filenames', () => {
      expect(extractFilename('/api/files/serve/123')).toBe('123')
    })
  })

  describe('backward compatibility', () => {
    it.concurrent('should match old behavior for legitimate local files', () => {
      // These test cases verify that our security fix maintains exact backward compatibility
      // for all legitimate use cases found in the existing codebase
      expect(extractFilename('/api/files/serve/test-file.txt')).toBe('test-file.txt')
      expect(extractFilename('/api/files/serve/nonexistent.txt')).toBe('nonexistent.txt')
    })

    it.concurrent('should match old behavior for legitimate cloud files', () => {
      // These test cases are from the actual delete route tests
      expect(extractFilename('/api/files/serve/s3/1234567890-test-file.txt')).toBe(
        's3/1234567890-test-file.txt'
      )
      expect(extractFilename('/api/files/serve/blob/1234567890-test-document.pdf')).toBe(
        'blob/1234567890-test-document.pdf'
      )
    })

    it.concurrent('should match old behavior for simple paths', () => {
      // These match the mock implementations in serve route tests
      expect(extractFilename('simple-file.txt')).toBe('simple-file.txt')
      expect(extractFilename('nested/path/file.txt')).toBe('file.txt')
    })
  })
})
