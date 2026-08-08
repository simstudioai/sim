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
  normalizeZohoDeskCommaList,
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

    // apiDomain reaches this helper from injected context, so a lookalike or
    // plaintext host must never receive the OAuth token.
    it('falls back to the US base for non-Zoho, lookalike, or non-https hosts', () => {
      expect(getZohoDeskApiBase({ apiDomain: 'https://desk.zoho.com.attacker.com' })).toBe(
        'https://desk.zoho.com/api/v1'
      )
      expect(getZohoDeskApiBase({ apiDomain: 'https://attacker.com' })).toBe(
        'https://desk.zoho.com/api/v1'
      )
      expect(getZohoDeskApiBase({ apiDomain: 'http://desk.zoho.eu' })).toBe(
        'https://desk.zoho.com/api/v1'
      )
      expect(getZohoDeskApiBase({ apiDomain: 'not-a-url' })).toBe('https://desk.zoho.com/api/v1')
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

    it('names the offending fields from a validation failure', () => {
      expect(
        getZohoDeskErrorMessage(
          {
            errorCode: 'INVALID_DATA',
            message: 'The data does not comply to the validation restrictions defined.',
            errors: [
              { fieldName: '/contactId', errorType: 'invalid' },
              { fieldName: '/departmentId', errorType: 'invalid' },
            ],
          },
          'fallback'
        )
      ).toBe(
        'The data does not comply to the validation restrictions defined. (/contactId: invalid; /departmentId: invalid)'
      )
    })

    it('accepts the prose errorMessage shape and skips unusable entries', () => {
      expect(
        getZohoDeskErrorMessage(
          {
            message: 'Invalid',
            errors: [{ fieldName: '/status', errorMessage: 'is not a valid status' }, {}, null],
          },
          'fallback'
        )
      ).toBe('Invalid (/status: is not a valid status)')
    })

    it('leaves the message untouched when there are no field errors', () => {
      expect(getZohoDeskErrorMessage({ message: 'Not found', errors: [] }, 'fallback')).toBe(
        'Not found'
      )
    })
  })

  describe('normalizeZohoDeskCommaList', () => {
    it('collapses "a, b" to "a,b"', () => {
      expect(normalizeZohoDeskCommaList('accounts, owner')).toBe('accounts,owner')
    })

    it('preserves interior spaces so multi-word filter values still match', () => {
      expect(normalizeZohoDeskCommaList('Open, On Hold')).toBe('Open,On Hold')
    })

    it('accepts the array a multi-select subBlock stores', () => {
      expect(normalizeZohoDeskCommaList(['a', 'b'])).toBe('a,b')
      // An emptied picker stores `[]`; calling .split on it would throw.
      expect(normalizeZohoDeskCommaList([])).toBeUndefined()
    })

    it('drops empty entries and returns undefined when nothing is left', () => {
      expect(normalizeZohoDeskCommaList(' contacts , , assignee ')).toBe('contacts,assignee')
      expect(normalizeZohoDeskCommaList('  ')).toBeUndefined()
      expect(normalizeZohoDeskCommaList(undefined)).toBeUndefined()
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

    // Zoho spells the HTML discriminator differently per resource: comments come
    // back as `html`, threads as the MIME form `text/html`. A strict `=== 'html'`
    // check silently passed thread markup through as "plain text".
    it('strips HTML for the text/html spelling Zoho uses on threads', () => {
      expect(deriveZohoContentText('<b>hi</b>', 'text/html')).toBe('hi')
    })

    it('strips HTML for a parameterized or differently-cased content type', () => {
      expect(deriveZohoContentText('<b>hi</b>', 'text/html; charset=UTF-8')).toBe('hi')
      expect(deriveZohoContentText('<b>hi</b>', 'TEXT/HTML')).toBe('hi')
      expect(deriveZohoContentText('<b>hi</b>', 'HTML')).toBe('hi')
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

    // Zoho ships ticket descriptions as HTML with NO content-type key — this is
    // the exact shape from Zoho's own Ticket_Add webhook sample. Gating the strip
    // on a `descriptionContentType` that never arrives made descriptionText a
    // byte-identical copy of the markup, so this case must stay unfabricated: no
    // descriptionContentType key anywhere in the fixture.
    it('strips HTML from a ticket description that carries no content-type key', () => {
      const ticket = { id: '5', subject: 'Delay', description: '<div>order is late</div>' }
      const result = withDerivedContentText(ticket) as Record<string, unknown>
      expect(result.description).toBe('<div>order is late</div>')
      expect(result.descriptionText).toBe('order is late')
      expect('contentText' in result).toBe(false)
    })

    it('leaves a plain-text ticket description readable', () => {
      const result = withDerivedContentText({
        id: '7',
        description: 'order is late',
      }) as Record<string, unknown>
      expect(result.descriptionText).toBe('order is late')
    })

    // Zoho ships BOTH shapes on `description` with no discriminator: HTML on the
    // webhook payload, plain text in the REST samples. Converting unconditionally
    // decodes entities and deletes tag-shaped text that was never markup, so a
    // plain body must pass through byte-for-byte.
    it('does not mangle plain text that merely looks tag-ish or has entities', () => {
      const cases = [
        'a < b > c',
        'compare a&b; then ship',
        'use the <not a tag notation',
        'SELECT * FROM t WHERE x < 5 AND y > 2',
      ]
      for (const description of cases) {
        const result = withDerivedContentText({ description }) as Record<string, unknown>
        expect(result.descriptionText).toBe(description)
      }
    })

    // A bare angle-bracket pair is not markup. These are realistic support-ticket
    // bodies, and running them through html-to-text deletes everything between
    // the brackets ("if x<y then z>0" became "if x0").
    it('preserves plain text containing angle-bracket pairs', () => {
      const cases = [
        'if x<y then z>0',
        'replace <username> with the real name',
        'SELECT * FROM t WHERE a<b AND c>d',
      ]
      for (const description of cases) {
        const result = withDerivedContentText({ description }) as Record<string, unknown>
        expect(result.descriptionText).toBe(description)
      }
    })

    it('strips hex-entity encoded bodies too', () => {
      const result = withDerivedContentText({
        description: 'Sam&#x27;s order failed',
      }) as Record<string, unknown>
      expect(result.descriptionText).toBe("Sam's order failed")
    })

    it('still strips a genuinely HTML description', () => {
      const result = withDerivedContentText({
        description: '<div>order is <b>late</b></div>',
      }) as Record<string, unknown>
      expect(result.descriptionText).toBe('order is late')
    })

    it('still honors an explicit descriptionContentType if Zoho ever sends one', () => {
      const result = withDerivedContentText({
        description: '<b>literal</b>',
        descriptionContentType: 'plainText',
      }) as Record<string, unknown>
      expect(result.descriptionText).toBe('<b>literal</b>')
    })

    it('derives both fields when a resource carries content and description', () => {
      const result = withDerivedContentText({
        content: '<b>c</b>',
        contentType: 'text/html',
        description: '<b>d</b>',
      }) as Record<string, unknown>
      expect(result.contentText).toBe('c')
      expect(result.descriptionText).toBe('d')
    })

    it('omits descriptionText when there is no string description', () => {
      const result = withDerivedContentText({ id: '6', description: null }) as Record<
        string,
        unknown
      >
      expect('descriptionText' in result).toBe(false)
    })
  })
})
