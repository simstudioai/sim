/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { assertZohoUrl, isZohoHost } from '@/tools/zoho_desk/host-allowlist'
import {
  buildZohoDeskHeaders,
  convertZohoHtmlToText,
  deriveAttachmentName,
  deriveZohoContentText,
  getZohoDeskApiBase,
  getZohoDeskErrorMessage,
  resolveZohoAttachmentUrl,
  withDerivedContentText,
} from '@/tools/zoho_desk/utils'

describe('zoho desk tool utils', () => {
  describe('getZohoDeskApiBase', () => {
    it('uses the persisted data-center Desk base', () => {
      expect(getZohoDeskApiBase({ apiDomain: 'https://desk.zoho.eu' })).toBe(
        'https://desk.zoho.eu/api/v1'
      )
    })

    it('strips trailing slashes', () => {
      expect(getZohoDeskApiBase({ apiDomain: 'https://desk.zoho.in/' })).toBe(
        'https://desk.zoho.in/api/v1'
      )
    })

    it('falls back to the US host when no api domain is provided', () => {
      expect(getZohoDeskApiBase({})).toBe('https://desk.zoho.com/api/v1')
    })
  })

  describe('buildZohoDeskHeaders', () => {
    it('builds Zoho-oauthtoken auth + orgId headers', () => {
      const headers = buildZohoDeskHeaders({ accessToken: 'abc', orgId: '700123' })
      expect(headers.Authorization).toBe('Zoho-oauthtoken abc')
      expect(headers.orgId).toBe('700123')
      expect(headers['Content-Type']).toBe('application/json')
    })

    it('throws when the access token is missing', () => {
      expect(() => buildZohoDeskHeaders({ accessToken: '', orgId: '1' })).toThrow(/access token/i)
    })

    it('throws when the orgId is missing', () => {
      expect(() => buildZohoDeskHeaders({ accessToken: 'x', orgId: '' })).toThrow(/organization/i)
    })
  })

  describe('getZohoDeskErrorMessage', () => {
    it('prefers the message field', () => {
      expect(getZohoDeskErrorMessage({ message: 'Bad request' }, 'fallback')).toBe('Bad request')
    })

    it('falls back to errorCode then the fallback', () => {
      expect(getZohoDeskErrorMessage({ errorCode: 'INVALID_DATA' }, 'fallback')).toBe(
        'INVALID_DATA'
      )
      expect(getZohoDeskErrorMessage(null, 'fallback')).toBe('fallback')
    })
  })

  describe('deriveAttachmentName', () => {
    it('prefers an explicit file name', () => {
      expect(
        deriveAttachmentName('mine.pdf', 'attachment; filename="other.pdf"', '/a/b/content')
      ).toBe('mine.pdf')
    })

    it('uses the Content-Disposition filename', () => {
      expect(
        deriveAttachmentName(null, 'attachment; filename="report.pdf"', '/tickets/1/attachments/2')
      ).toBe('report.pdf')
    })

    it('decodes an RFC 5987 (UTF-8) Content-Disposition filename', () => {
      expect(
        deriveAttachmentName(null, "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf", '/x')
      ).toBe('résumé.pdf')
    })

    it('falls back to a URL segment that looks like a file name', () => {
      expect(deriveAttachmentName(null, null, '/files/photo.png')).toBe('photo.png')
    })

    it('ignores a generic /content endpoint and returns a plain fallback', () => {
      expect(deriveAttachmentName(null, null, '/tickets/1/attachments/2/content')).toBe(
        'attachment'
      )
      expect(deriveAttachmentName('', '', '/tickets/1/attachments/2')).toBe('attachment')
    })
  })

  describe('isZohoHost', () => {
    it('accepts Zoho apex hosts and their subdomains across data centers', () => {
      expect(isZohoHost('desk.zoho.com')).toBe(true)
      expect(isZohoHost('desk.zoho.eu')).toBe(true)
      expect(isZohoHost('zohoapis.com.au')).toBe(true)
      expect(isZohoHost('DESK.ZOHO.IN')).toBe(true)
    })

    it('rejects lookalike and attacker hosts', () => {
      expect(isZohoHost('zoho.attacker.com')).toBe(false)
      expect(isZohoHost('desk.zoho.com.attacker.com')).toBe(false)
      expect(isZohoHost('notzoho.com')).toBe(false)
      expect(isZohoHost('evil.com')).toBe(false)
    })
  })

  describe('assertZohoUrl', () => {
    it('returns the URL for an https Zoho host', () => {
      expect(assertZohoUrl('https://desk.zoho.eu/api/v1/organizations').host).toBe('desk.zoho.eu')
    })

    it('throws for a non-Zoho host or non-https scheme', () => {
      expect(() => assertZohoUrl('https://attacker.com/api/v1/organizations')).toThrow()
      expect(() => assertZohoUrl('http://desk.zoho.com/api/v1/organizations')).toThrow()
    })
  })

  describe('resolveZohoAttachmentUrl', () => {
    const apiBase = 'https://desk.zoho.com/api/v1'

    it('uses an absolute http(s) href as-is', () => {
      expect(
        resolveZohoAttachmentUrl('https://desk.zoho.eu/api/v1/tickets/1/x/content', apiBase).href
      ).toBe('https://desk.zoho.eu/api/v1/tickets/1/x/content')
    })

    it('does not duplicate /api/v1 when the relative href already includes it', () => {
      expect(
        resolveZohoAttachmentUrl('/api/v1/tickets/1/attachments/2/content', apiBase).href
      ).toBe('https://desk.zoho.com/api/v1/tickets/1/attachments/2/content')
      expect(resolveZohoAttachmentUrl('api/v1/tickets/1/attachments/2/content', apiBase).href).toBe(
        'https://desk.zoho.com/api/v1/tickets/1/attachments/2/content'
      )
    })

    it('resolves a relative href without an api/v1 prefix against the api base', () => {
      expect(resolveZohoAttachmentUrl('/tickets/1/x/content', apiBase).href).toBe(
        'https://desk.zoho.com/api/v1/tickets/1/x/content'
      )
      expect(resolveZohoAttachmentUrl('tickets/1/x/content', apiBase).href).toBe(
        'https://desk.zoho.com/api/v1/tickets/1/x/content'
      )
    })
  })

  describe('convertZohoHtmlToText', () => {
    it('strips HTML tags to readable plain text', () => {
      const html = '<div style="direction: ltr; font-size: 13px;"><div>testing</div></div>'
      expect(convertZohoHtmlToText(html)).toBe('testing')
    })

    it('returns an empty string for empty input', () => {
      expect(convertZohoHtmlToText('')).toBe('')
    })

    it('keeps anchor text and drops image subtrees', () => {
      const html =
        '<p>See <a href="https://x.test">the docs</a></p><img src="https://x.test/a.png">'
      const text = convertZohoHtmlToText(html)
      expect(text).toContain('See the docs')
      expect(text).not.toContain('a.png')
    })

    it('hides an anchor href that equals its link text', () => {
      expect(convertZohoHtmlToText('<a href="https://x.test">https://x.test</a>')).toBe(
        'https://x.test'
      )
    })
  })

  describe('deriveZohoContentText', () => {
    it('strips HTML when contentType is html', () => {
      expect(deriveZohoContentText('<b>hi</b>', 'html')).toBe('hi')
    })

    it('returns plainText content unchanged', () => {
      expect(deriveZohoContentText('<b>literal</b>', 'plainText')).toBe('<b>literal</b>')
    })

    it('mirrors content when contentType is unrecognized or absent', () => {
      expect(deriveZohoContentText('raw', undefined)).toBe('raw')
      expect(deriveZohoContentText('raw', 'other')).toBe('raw')
    })

    it('returns undefined when content is not a string', () => {
      expect(deriveZohoContentText(null, 'html')).toBeUndefined()
      expect(deriveZohoContentText(undefined, 'plainText')).toBeUndefined()
    })
  })

  describe('withDerivedContentText', () => {
    it('adds a stripped contentText alongside the untouched raw HTML content', () => {
      const comment = { id: '1', content: '<div>testing</div>', contentType: 'html' }
      const result = withDerivedContentText(comment) as Record<string, unknown>
      expect(result.content).toBe('<div>testing</div>')
      expect(result.contentType).toBe('html')
      expect(result.contentText).toBe('testing')
    })

    it('mirrors content into contentText for plainText resources', () => {
      const comment = { id: '2', content: 'plain note', contentType: 'plainText' }
      const result = withDerivedContentText(comment) as Record<string, unknown>
      expect(result.contentText).toBe('plain note')
      expect(result.content).toBe('plain note')
    })

    it('leaves resources without string content unchanged (no contentText key)', () => {
      const thread = { id: '3', content: null, contentType: 'html' }
      const result = withDerivedContentText(thread) as Record<string, unknown>
      expect('contentText' in result).toBe(false)
      const ticketPayload = { id: '4', subject: 'no content pair' }
      expect(withDerivedContentText(ticketPayload)).toEqual(ticketPayload)
    })

    it('passes through non-object values', () => {
      expect(withDerivedContentText(null)).toBeNull()
      expect(withDerivedContentText('str')).toBe('str')
    })
  })
})
