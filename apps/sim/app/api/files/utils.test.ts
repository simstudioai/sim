import { describe, expect, it } from 'vitest'
import { createFileResponse, extractFilename, findLocalFile } from './utils'

describe('extractFilename', () => {
  describe('legitimate file paths', () => {
    it('should extract filename from standard serve path', () => {
      expect(extractFilename('/api/files/serve/test-file.txt')).toBe('test-file.txt')
    })

    it('should extract filename from serve path with special characters', () => {
      expect(extractFilename('/api/files/serve/document-with-dashes_and_underscores.pdf')).toBe(
        'document-with-dashes_and_underscores.pdf'
      )
    })

    it('should handle simple filename without serve path', () => {
      expect(extractFilename('simple-file.txt')).toBe('simple-file.txt')
    })

    it('should extract last segment from nested path', () => {
      expect(extractFilename('nested/path/file.txt')).toBe('file.txt')
    })
  })

  describe('cloud storage paths', () => {
    it('should preserve S3 path structure', () => {
      expect(extractFilename('/api/files/serve/s3/1234567890-test-file.txt')).toBe(
        's3/1234567890-test-file.txt'
      )
    })

    it('should preserve S3 path with nested folders', () => {
      expect(extractFilename('/api/files/serve/s3/folder/subfolder/document.pdf')).toBe(
        's3/folder/subfolder/document.pdf'
      )
    })

    it('should preserve Azure Blob path structure', () => {
      expect(extractFilename('/api/files/serve/blob/1234567890-test-document.pdf')).toBe(
        'blob/1234567890-test-document.pdf'
      )
    })

    it('should preserve Blob path with nested folders', () => {
      expect(extractFilename('/api/files/serve/blob/uploads/user-files/report.xlsx')).toBe(
        'blob/uploads/user-files/report.xlsx'
      )
    })
  })

  describe('security - path traversal prevention', () => {
    it('should sanitize basic path traversal attempt', () => {
      expect(extractFilename('/api/files/serve/../config.txt')).toBe('config.txt')
    })

    it('should sanitize deep path traversal attempt', () => {
      expect(extractFilename('/api/files/serve/../../../../../etc/passwd')).toBe('etcpasswd')
    })

    it('should sanitize multiple path traversal patterns', () => {
      expect(extractFilename('/api/files/serve/../../secret.txt')).toBe('secret.txt')
    })

    it('should sanitize path traversal with forward slashes', () => {
      expect(extractFilename('/api/files/serve/../../../system/file')).toBe('systemfile')
    })

    it('should sanitize mixed path traversal patterns', () => {
      expect(extractFilename('/api/files/serve/../folder/../file.txt')).toBe('folderfile.txt')
    })

    it('should remove directory separators from local filenames', () => {
      expect(extractFilename('/api/files/serve/folder/with/separators.txt')).toBe(
        'folderwithseparators.txt'
      )
    })

    it('should handle backslash path separators (Windows style)', () => {
      expect(extractFilename('/api/files/serve/folder\\file.txt')).toBe('folderfile.txt')
    })
  })

  describe('cloud storage path traversal prevention', () => {
    it('should sanitize S3 path traversal attempts while preserving structure', () => {
      expect(extractFilename('/api/files/serve/s3/../config')).toBe('s3/config')
    })

    it('should sanitize S3 path with nested traversal attempts', () => {
      expect(extractFilename('/api/files/serve/s3/folder/../sensitive/../file.txt')).toBe(
        's3/folder/sensitive/file.txt'
      )
    })

    it('should sanitize Blob path traversal attempts while preserving structure', () => {
      expect(extractFilename('/api/files/serve/blob/../system.txt')).toBe('blob/system.txt')
    })

    it('should remove leading dots from cloud path segments', () => {
      expect(extractFilename('/api/files/serve/s3/.hidden/../file.txt')).toBe('s3/hidden/file.txt')
    })
  })

  describe('edge cases and error handling', () => {
    it('should handle filename with dots (but not traversal)', () => {
      expect(extractFilename('/api/files/serve/file.with.dots.txt')).toBe('file.with.dots.txt')
    })

    it('should handle filename with multiple extensions', () => {
      expect(extractFilename('/api/files/serve/archive.tar.gz')).toBe('archive.tar.gz')
    })

    it('should throw error for empty filename after sanitization', () => {
      expect(() => extractFilename('/api/files/serve/')).toThrow(
        'Invalid or empty filename after sanitization'
      )
    })

    it('should throw error for filename that becomes empty after path traversal removal', () => {
      expect(() => extractFilename('/api/files/serve/../..')).toThrow(
        'Invalid or empty filename after sanitization'
      )
    })

    it('should handle single character filenames', () => {
      expect(extractFilename('/api/files/serve/a')).toBe('a')
    })

    it('should handle numeric filenames', () => {
      expect(extractFilename('/api/files/serve/123')).toBe('123')
    })
  })

  describe('backward compatibility', () => {
    it('should match old behavior for legitimate local files', () => {
      // These test cases verify that our security fix maintains exact backward compatibility
      // for all legitimate use cases found in the existing codebase
      expect(extractFilename('/api/files/serve/test-file.txt')).toBe('test-file.txt')
      expect(extractFilename('/api/files/serve/nonexistent.txt')).toBe('nonexistent.txt')
    })

    it('should match old behavior for legitimate cloud files', () => {
      // These test cases are from the actual delete route tests
      expect(extractFilename('/api/files/serve/s3/1234567890-test-file.txt')).toBe(
        's3/1234567890-test-file.txt'
      )
      expect(extractFilename('/api/files/serve/blob/1234567890-test-document.pdf')).toBe(
        'blob/1234567890-test-document.pdf'
      )
    })

    it('should match old behavior for simple paths', () => {
      // These match the mock implementations in serve route tests
      expect(extractFilename('simple-file.txt')).toBe('simple-file.txt')
      expect(extractFilename('nested/path/file.txt')).toBe('file.txt')
    })
  })

  describe('File Serving Security Tests', () => {
    describe('createFileResponse security headers', () => {
      it('should serve safe images inline with proper headers', () => {
        const response = createFileResponse({
          buffer: Buffer.from('fake-image-data'),
          contentType: 'image/png',
          filename: 'safe-image.png',
        })

        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Type')).toBe('image/png')
        expect(response.headers.get('Content-Disposition')).toBe(
          'inline; filename="safe-image.png"'
        )
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
        expect(response.headers.get('Content-Security-Policy')).toBe(
          "default-src 'none'; style-src 'unsafe-inline'; sandbox;"
        )
      })

      it('should serve PDFs inline safely', () => {
        const response = createFileResponse({
          buffer: Buffer.from('fake-pdf-data'),
          contentType: 'application/pdf',
          filename: 'document.pdf',
        })

        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Type')).toBe('application/pdf')
        expect(response.headers.get('Content-Disposition')).toBe('inline; filename="document.pdf"')
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      })

      it('should force attachment for HTML files to prevent XSS', () => {
        const response = createFileResponse({
          buffer: Buffer.from('<script>alert("XSS")</script>'),
          contentType: 'text/html',
          filename: 'malicious.html',
        })

        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
        expect(response.headers.get('Content-Disposition')).toBe(
          'attachment; filename="malicious.html"'
        )
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      })

      it('should force attachment for SVG files to prevent XSS', () => {
        const response = createFileResponse({
          buffer: Buffer.from(
            '<svg onload="alert(\'XSS\')" xmlns="http://www.w3.org/2000/svg"></svg>'
          ),
          contentType: 'image/svg+xml',
          filename: 'malicious.svg',
        })

        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
        expect(response.headers.get('Content-Disposition')).toBe(
          'attachment; filename="malicious.svg"'
        )
      })

      it('should override dangerous content types to safe alternatives', () => {
        const response = createFileResponse({
          buffer: Buffer.from('<svg>safe content</svg>'),
          contentType: 'image/svg+xml',
          filename: 'image.png', // Extension doesn't match content-type
        })

        expect(response.status).toBe(200)
        // Should override SVG content type to plain text for safety
        expect(response.headers.get('Content-Type')).toBe('text/plain')
        expect(response.headers.get('Content-Disposition')).toBe('inline; filename="image.png"')
      })

      it('should force attachment for JavaScript files', () => {
        const response = createFileResponse({
          buffer: Buffer.from('alert("XSS")'),
          contentType: 'application/javascript',
          filename: 'malicious.js',
        })

        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
        expect(response.headers.get('Content-Disposition')).toBe(
          'attachment; filename="malicious.js"'
        )
      })

      it('should force attachment for CSS files', () => {
        const response = createFileResponse({
          buffer: Buffer.from('body { background: url(javascript:alert("XSS")) }'),
          contentType: 'text/css',
          filename: 'malicious.css',
        })

        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
        expect(response.headers.get('Content-Disposition')).toBe(
          'attachment; filename="malicious.css"'
        )
      })

      it('should force attachment for XML files', () => {
        const response = createFileResponse({
          buffer: Buffer.from('<?xml version="1.0"?><root><script>alert("XSS")</script></root>'),
          contentType: 'application/xml',
          filename: 'malicious.xml',
        })

        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
        expect(response.headers.get('Content-Disposition')).toBe(
          'attachment; filename="malicious.xml"'
        )
      })

      it('should serve text files safely', () => {
        const response = createFileResponse({
          buffer: Buffer.from('Safe text content'),
          contentType: 'text/plain',
          filename: 'document.txt',
        })

        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Type')).toBe('text/plain')
        expect(response.headers.get('Content-Disposition')).toBe('inline; filename="document.txt"')
      })

      it('should force attachment for unknown/unsafe content types', () => {
        const response = createFileResponse({
          buffer: Buffer.from('unknown content'),
          contentType: 'application/unknown',
          filename: 'unknown.bin',
        })

        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Type')).toBe('application/unknown')
        expect(response.headers.get('Content-Disposition')).toBe(
          'attachment; filename="unknown.bin"'
        )
      })
    })

    describe('Content Security Policy', () => {
      it('should include CSP header in all responses', () => {
        const response = createFileResponse({
          buffer: Buffer.from('test'),
          contentType: 'text/plain',
          filename: 'test.txt',
        })

        const csp = response.headers.get('Content-Security-Policy')
        expect(csp).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox;")
      })

      it('should include X-Content-Type-Options header', () => {
        const response = createFileResponse({
          buffer: Buffer.from('test'),
          contentType: 'text/plain',
          filename: 'test.txt',
        })

        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      })
    })
  })
})

describe('findLocalFile - Path Traversal Security Tests', () => {
  describe('path traversal attack prevention', () => {
    it.concurrent('should reject classic path traversal attacks', () => {
      const maliciousInputs = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\config\\sam',
        '../../../../etc/shadow',
        '../config.json',
        '..\\config.ini',
      ]

      maliciousInputs.forEach((input) => {
        const result = findLocalFile(input)
        expect(result).toBeNull()
      })
    })

    it.concurrent('should reject encoded path traversal attempts', () => {
      const encodedInputs = [
        '%2e%2e%2f%2e%2e%2f%65%74%63%2f%70%61%73%73%77%64', // ../../../etc/passwd
        '..%2f..%2fetc%2fpasswd',
        '..%5c..%5cconfig.ini',
      ]

      encodedInputs.forEach((input) => {
        const result = findLocalFile(input)
        expect(result).toBeNull()
      })
    })

    it.concurrent('should reject mixed path separators', () => {
      const mixedInputs = ['../..\\config.txt', '..\\../secret.ini', '/..\\..\\system32']

      mixedInputs.forEach((input) => {
        const result = findLocalFile(input)
        expect(result).toBeNull()
      })
    })

    it.concurrent('should reject filenames with dangerous characters', () => {
      const dangerousInputs = [
        'file:with:colons.txt',
        'file|with|pipes.txt',
        'file?with?questions.txt',
        'file*with*asterisks.txt',
      ]

      dangerousInputs.forEach((input) => {
        const result = findLocalFile(input)
        expect(result).toBeNull()
      })
    })

    it.concurrent('should reject null and empty inputs', () => {
      expect(findLocalFile('')).toBeNull()
      expect(findLocalFile('   ')).toBeNull()
      expect(findLocalFile('\t\n')).toBeNull()
    })

    it.concurrent('should reject filenames that become empty after sanitization', () => {
      const emptyAfterSanitization = ['../..', '..\\..\\', '////', '....', '..']

      emptyAfterSanitization.forEach((input) => {
        const result = findLocalFile(input)
        expect(result).toBeNull()
      })
    })
  })

  describe('security validation passes for legitimate files', () => {
    it.concurrent('should accept properly formatted filenames without throwing errors', () => {
      const legitimateInputs = [
        'document.pdf',
        'image.png',
        'data.csv',
        'report-2024.doc',
        'file_with_underscores.txt',
        'file-with-dashes.json',
      ]

      legitimateInputs.forEach((input) => {
        // Should not throw security errors for legitimate filenames
        expect(() => findLocalFile(input)).not.toThrow()
      })
    })
  })
})
