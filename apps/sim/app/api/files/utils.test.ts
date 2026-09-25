import { describe, expect, it } from 'vitest'
import {
  createConditionalFileResponse,
  createFileResponse,
  encodeFilenameForHeader,
  extractFilename,
  findLocalFile,
} from '@/app/api/files/utils'

describe('extractFilename', () => {
  describe('security - path traversal prevention', () => {
    it('should sanitize basic path traversal attempt', () => {
      expect(extractFilename('/api/files/serve/../config.txt')).toBe('config.txt')
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

    it('should remove leading dots from cloud path segments', () => {
      expect(extractFilename('/api/files/serve/s3/.hidden/../file.txt')).toBe('s3/hidden/file.txt')
    })
  })

  describe('edge cases and error handling', () => {
    it('should throw error for empty filename after sanitization', () => {
      expect(() => extractFilename('/api/files/serve/')).toThrow(
        'Invalid or empty filename after sanitization'
      )
    })
  })

  describe('File Serving Security Tests', () => {
    describe('createFileResponse security headers', () => {
      it('appends the content-type extension to an extensionless download name', () => {
        const response = createFileResponse({
          buffer: Buffer.from('fake-image-data'),
          contentType: 'image/png',
          filename: 'navbar_2',
        })
        expect(response.headers.get('Content-Disposition')).toBe('inline; filename="navbar_2.png"')
      })

      it('defaults to a PRIVATE cache so access-verified content is never shared-cached', () => {
        const response = createFileResponse({
          buffer: Buffer.from('fake-image-data'),
          contentType: 'image/png',
          filename: 'safe-image.png',
        })
        // No explicit cacheControl → must NOT be `public` (a shared cache/CDN could re-serve authed bytes).
        expect(response.headers.get('Cache-Control')).toBe('private, no-cache')
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

      it('should serve SVG files inline with CSP sandbox protection', () => {
        const response = createFileResponse({
          buffer: Buffer.from(
            '<svg onload="alert(\'XSS\')" xmlns="http://www.w3.org/2000/svg"></svg>'
          ),
          contentType: 'image/svg+xml',
          filename: 'image.svg',
        })

        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Type')).toBe('image/svg+xml')
        expect(response.headers.get('Content-Disposition')).toBe('inline; filename="image.svg"')
        expect(response.headers.get('Content-Security-Policy')).toBe(
          "default-src 'none'; style-src 'unsafe-inline'; sandbox;"
        )
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

    /**
     * `originalName` is attacker-controlled — it only rejects path separators — so a
     * quote can reach the header and close the quoted parameter early. RFC 6266 tells
     * clients to prefer `filename*`, so an injected one decides the name the file
     * lands under on disk regardless of what the product UI displayed.
     */
    describe('encodeFilenameForHeader parameter injection', () => {
      it('neutralizes a quote that would close the quoted filename parameter', () => {
        expect(encodeFilenameForHeader(`report.pdf"; filename*=UTF-8''invoice.html`)).toBe(
          `filename="report.pdf__ filename*=UTF-8''invoice.html"; filename*=UTF-8''report.pdf%22%3B%20filename%2A%3DUTF-8%27%27invoice.html`
        )
      })

      it('neutralizes the same injection on the non-ascii branch', () => {
        expect(encodeFilenameForHeader(`repört.pdf"; filename*=UTF-8''invoice.html`)).toBe(
          `filename="rep_rt.pdf__ filename*=UTF-8''invoice.html"; filename*=UTF-8''rep%C3%B6rt.pdf%22%3B%20filename%2A%3DUTF-8%27%27invoice.html`
        )
      })

      it('emits exactly one filename* parameter, holding the real name', () => {
        const name = `report.pdf"; filename*=UTF-8''invoice.html`
        const header = encodeFilenameForHeader(name)
        // Strip the quoted value: text inside it is inert, so only what follows counts.
        const parameters = `${header.slice(0, header.indexOf('filename="'))}${header.slice(header.lastIndexOf('"') + 1)}`
        expect(parameters.match(/filename\*=/g)).toHaveLength(1)
        // The one surviving filename* is the real name, not the injected one.
        expect(decodeURIComponent(parameters.split(`filename*=UTF-8''`)[1])).toBe(name)
      })

      it('percent-encodes an apostrophe so it cannot desync the ext-value delimiter', () => {
        const header = encodeFilenameForHeader("it's a café.pdf")
        expect(header.split(`filename*=UTF-8''`)[1]).toBe('it%27s%20a%20caf%C3%A9.pdf')
      })

      it('encodes control characters that would otherwise be an invalid header value', () => {
        const header = encodeFilenameForHeader('report\r\nX-Injected: 1.pdf')
        expect(header).toBe(
          `filename="report__X-Injected: 1.pdf"; filename*=UTF-8''report%0D%0AX-Injected%3A%201.pdf`
        )
        expect(
          () =>
            new Response('data', { headers: { 'Content-Disposition': `attachment; ${header}` } })
        ).not.toThrow()
      })
    })
  })
})

describe('findLocalFile - Path Traversal Security Tests', () => {
  describe('path traversal attack prevention', () => {
    it.concurrent('should reject classic path traversal attacks', async () => {
      const maliciousInputs = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\config\\sam',
        '../../../../etc/shadow',
        '../config.json',
        '..\\config.ini',
      ]

      for (const input of maliciousInputs) {
        const result = await findLocalFile(input)
        expect(result).toBeNull()
      }
    })

    it.concurrent('should reject encoded path traversal attempts', async () => {
      const encodedInputs = [
        '%2e%2e%2f%2e%2e%2f%65%74%63%2f%70%61%73%73%77%64', // ../../../etc/passwd
        '..%2f..%2fetc%2fpasswd',
        '..%5c..%5cconfig.ini',
      ]

      for (const input of encodedInputs) {
        const result = await findLocalFile(input)
        expect(result).toBeNull()
      }
    })

    it.concurrent('should reject mixed path separators', async () => {
      const mixedInputs = ['../..\\config.txt', '..\\../secret.ini', '/..\\..\\system32']

      for (const input of mixedInputs) {
        const result = await findLocalFile(input)
        expect(result).toBeNull()
      }
    })

    it.concurrent('should reject filenames with dangerous characters', async () => {
      const dangerousInputs = [
        'file:with:colons.txt',
        'file|with|pipes.txt',
        'file?with?questions.txt',
        'file*with*asterisks.txt',
      ]

      for (const input of dangerousInputs) {
        const result = await findLocalFile(input)
        expect(result).toBeNull()
      }
    })

    it.concurrent('should reject null and empty inputs', async () => {
      expect(await findLocalFile('')).toBeNull()
      expect(await findLocalFile('   ')).toBeNull()
      expect(await findLocalFile('\t\n')).toBeNull()
    })

    it.concurrent('should reject filenames that become empty after sanitization', async () => {
      const emptyAfterSanitization = ['../..', '..\\..\\', '////', '....', '..']

      for (const input of emptyAfterSanitization) {
        const result = await findLocalFile(input)
        expect(result).toBeNull()
      }
    })
  })
})

describe('createConditionalFileResponse', () => {
  const file = {
    buffer: Buffer.from('compiled-document-bytes'),
    contentType: 'application/pdf',
    filename: 'report.pdf',
    cacheControl: 'private, no-cache, must-revalidate',
  }

  function etagOf(ifNoneMatch: string | null = null): string {
    return createConditionalFileResponse(file, ifNoneMatch).headers.get('ETag') as string
  }

  it('sends the body with a strong validator when the client holds nothing', () => {
    const response = createConditionalFileResponse(file, null)

    expect(response.status).toBe(200)
    expect(response.headers.get('ETag')).toMatch(/^"[A-Za-z0-9_-]+"$/)
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache, must-revalidate')
  })

  it('answers 304 without a body when the client already holds these bytes', async () => {
    const response = createConditionalFileResponse(file, etagOf())

    expect(response.status).toBe(304)
    expect(await response.text()).toBe('')
    // Repeated so the stored response is refreshed with this request's lifetime.
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache, must-revalidate')
  })

  it('matches weakly, so a cache that stored a weak validator still revalidates', () => {
    expect(createConditionalFileResponse(file, `W/${etagOf()}`).status).toBe(304)
  })

  it('matches one entry out of a list, and the wildcard', () => {
    expect(createConditionalFileResponse(file, `"other", ${etagOf()}`).status).toBe(304)
    expect(createConditionalFileResponse(file, '*').status).toBe(304)
  })
})
