/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildMimeMessage,
  buildSimpleEmailMessage,
  encodeRfc2047,
  escapeHtml,
  htmlToPlainText,
  plainTextToHtml,
} from './utils'

function decodeSimpleMessage(encoded: string): string {
  return Buffer.from(encoded, 'base64url').toString('utf-8')
}

/**
 * Extract and base64-decode the body of a specific MIME part identified by its
 * Content-Type prefix (e.g. `text/plain`, `text/html`). Returns the decoded
 * UTF-8 string.
 */
function decodePart(mime: string, contentTypePrefix: string): string {
  const partRegex = new RegExp(
    `Content-Type: ${contentTypePrefix}[^\\n]*\\nContent-Transfer-Encoding: base64\\n\\n([\\s\\S]*?)\\n\\n--`
  )
  const match = mime.match(partRegex)
  if (!match) throw new Error(`No ${contentTypePrefix} part found`)
  return Buffer.from(match[1].replace(/\n/g, ''), 'base64').toString('utf-8')
}

describe('encodeRfc2047', () => {
  it('returns ASCII text unchanged', () => {
    expect(encodeRfc2047('Simple ASCII Subject')).toBe('Simple ASCII Subject')
  })

  it('returns empty string unchanged', () => {
    expect(encodeRfc2047('')).toBe('')
  })

  it('encodes emojis as RFC 2047 base64', () => {
    const result = encodeRfc2047('Time to Stretch! 🧘')
    expect(result).toBe('=?UTF-8?B?VGltZSB0byBTdHJldGNoISDwn6eY?=')
  })

  it('round-trips non-ASCII subjects correctly', () => {
    const subjects = ['Hello 世界', 'Café résumé', '🎉🎊🎈 Party!', '今週のミーティング']
    for (const subject of subjects) {
      const encoded = encodeRfc2047(subject)
      const match = encoded.match(/^=\?UTF-8\?B\?(.+)\?=$/)
      expect(match).not.toBeNull()
      const decoded = Buffer.from(match![1], 'base64').toString('utf-8')
      expect(decoded).toBe(subject)
    }
  })

  it('does not double-encode already-encoded subjects', () => {
    const alreadyEncoded = '=?UTF-8?B?VGltZSB0byBTdHJldGNoISDwn6eY?='
    expect(encodeRfc2047(alreadyEncoded)).toBe(alreadyEncoded)
  })
})

describe('escapeHtml', () => {
  it('escapes the five HTML special characters', () => {
    expect(escapeHtml(`<script>alert("x & y's")</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x &amp; y&#39;s&quot;)&lt;/script&gt;'
    )
  })
})

describe('plainTextToHtml', () => {
  it('renders blank lines as paragraph breaks and single newlines as <br>', () => {
    const html = plainTextToHtml('Hi Janice,\n\nHope you are well.\nSecond line.')
    expect(html).toContain('<p>Hi Janice,</p>')
    expect(html).toContain('<p>Hope you are well.<br>Second line.</p>')
  })

  it('escapes HTML in the source text', () => {
    expect(plainTextToHtml('<b>bold</b>')).toContain('&lt;b&gt;bold&lt;/b&gt;')
  })
})

describe('htmlToPlainText', () => {
  it('strips tags and decodes entities', () => {
    const result = htmlToPlainText('<p>Hi &amp; bye</p><p>Line<br>break</p>')
    expect(result).toBe('Hi & bye\n\nLine\nbreak')
  })

  it('drops <style> and <script> contents', () => {
    expect(htmlToPlainText('<style>p{}</style><p>Hi</p>')).toBe('Hi')
  })

  it('does not double-decode compound entities like &amp;lt;', () => {
    expect(htmlToPlainText('<p>&amp;lt; is the literal &lt; entity</p>')).toBe(
      '&lt; is the literal < entity'
    )
  })

  it('decodes decimal and hexadecimal numeric entities', () => {
    expect(htmlToPlainText('<p>&#8220;hi&#8221; and&#x2019;s</p>')).toBe(
      '\u201chi\u201d and\u2019s'
    )
  })

  it('preserves &#160; (non-breaking space) as U+00A0 for fidelity in plain-text output', () => {
    expect(htmlToPlainText('<p>a&#160;b</p>')).toBe('a\u00a0b')
  })

  it('elides anchor URLs that exactly match link text, and drops bare # anchors', () => {
    expect(
      htmlToPlainText('<p>Visit <a href="https://example.com">https://example.com</a></p>')
    ).toBe('Visit https://example.com')
    expect(htmlToPlainText('<p><a href="#section">Anchor</a></p>')).toBe('Anchor')
  })
})

describe('buildSimpleEmailMessage', () => {
  it('emits multipart/alternative with text/plain then text/html for plain-text input', () => {
    const encoded = buildSimpleEmailMessage({
      to: 'a@example.com',
      subject: 'Hi',
      body: 'Hi Janice,\n\nQuick question.',
    })
    const decoded = decodeSimpleMessage(encoded)
    expect(decoded).toMatch(/Content-Type: multipart\/alternative; boundary="([^"]+)"/)
    const plainIdx = decoded.indexOf('text/plain')
    const htmlIdx = decoded.indexOf('text/html')
    expect(plainIdx).toBeGreaterThan(-1)
    expect(htmlIdx).toBeGreaterThan(plainIdx)
    expect(decodePart(decoded, 'text/plain')).toBe('Hi Janice,\n\nQuick question.')
    expect(decodePart(decoded, 'text/html')).toContain('<p>Hi Janice,</p>')
  })

  it('encodes bodies as base64 so UTF-8 (emoji, accents) round-trips cleanly', () => {
    const body = 'Café 🎉 — résumé'
    const encoded = buildSimpleEmailMessage({
      to: 'a@example.com',
      subject: 'Hi',
      body,
    })
    const decoded = decodeSimpleMessage(encoded)
    expect(decoded).toContain('Content-Transfer-Encoding: base64')
    expect(decodePart(decoded, 'text/plain')).toBe(body)
    expect(decodePart(decoded, 'text/html')).toContain('Café 🎉 — résumé')
  })

  it('uses the supplied HTML body and derives a plain-text fallback when contentType is html', () => {
    const encoded = buildSimpleEmailMessage({
      to: 'a@example.com',
      subject: 'Hi',
      body: '<p>Hello <b>there</b></p>',
      contentType: 'html',
    })
    const decoded = decodeSimpleMessage(encoded)
    expect(decodePart(decoded, 'text/html')).toBe('<p>Hello <b>there</b></p>')
    expect(decodePart(decoded, 'text/plain')).toBe('Hello there')
  })

  it('includes threading headers when replying', () => {
    const encoded = buildSimpleEmailMessage({
      to: 'a@example.com',
      body: 'reply',
      inReplyTo: '<msg-1@example.com>',
      references: '<root@example.com>',
    })
    const decoded = decodeSimpleMessage(encoded)
    expect(decoded).toContain('In-Reply-To: <msg-1@example.com>')
    expect(decoded).toContain('References: <root@example.com> <msg-1@example.com>')
  })
})

describe('buildMimeMessage', () => {
  it('nests multipart/alternative inside multipart/mixed when attachments are present', () => {
    const message = buildMimeMessage({
      to: 'a@example.com',
      subject: 'Hi',
      body: 'Hello',
      attachments: [
        {
          filename: 'note.txt',
          mimeType: 'text/plain',
          content: Buffer.from('hi'),
        },
      ],
    })
    expect(message).toMatch(/Content-Type: multipart\/mixed; boundary="([^"]+)"/)
    expect(message).toMatch(/Content-Type: multipart\/alternative; boundary="([^"]+)"/)
    expect(message).toContain('Content-Disposition: attachment; filename="note.txt"')
    expect(decodePart(message, 'text/plain')).toBe('Hello')
    expect(decodePart(message, 'text/html')).toContain('<p>Hello</p>')
  })

  it('emits multipart/alternative without multipart/mixed when no attachments', () => {
    const message = buildMimeMessage({
      to: 'a@example.com',
      subject: 'Hi',
      body: 'Hello',
    })
    expect(message).toMatch(/Content-Type: multipart\/alternative; boundary="([^"]+)"/)
    expect(message).not.toContain('multipart/mixed')
  })
})
