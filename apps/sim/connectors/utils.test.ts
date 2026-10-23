import { knowledgeDocumentsUtilsMock } from '@sim/testing/mocks/knowledge-documents-utils.mock'
import { knowledgeSecureFetchMock } from '@sim/testing/mocks/knowledge-secure-fetch.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/documents/utils', () => knowledgeDocumentsUtilsMock)
vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => knowledgeSecureFetchMock)

import {
  appendPendingMicrosoftGraphFolders,
  assertMicrosoftGraphNextLink,
  BoundedLines,
  ConnectorListingScopeUnavailableError,
  decodeMicrosoftGraphTraversalCursor,
  extractConnectorText,
  hasIndexablePayload,
  htmlToPlainText,
  isIndexableConnectorFile,
  isSkippableMicrosoftGraphFolderError,
  looksLikeHtml,
  MICROSOFT_GRAPH_MAX_CURSOR_ENCODED_BYTES,
  MICROSOFT_GRAPH_MAX_ITEM_ID_BYTES,
  MICROSOFT_GRAPH_MAX_PENDING_FOLDERS,
  memberDocumentId,
  PER_MEMBER_LISTING_CONTEXT,
  parseDefaultedUnlimitedSafeInteger,
  readBodyWithLimit,
  sourceDocumentId,
  takeIndexableWithinCap,
} from '@/connectors/utils'

describe('member document identity', () => {
  const alice = { ...PER_MEMBER_LISTING_CONTEXT, memberId: 'alice' }
  const bob = { ...PER_MEMBER_LISTING_CONTEXT, memberId: 'bob' }

  it('isolates different member representations of the same source item', () => {
    const aliceId = memberDocumentId('site:document', alice)
    const bobId = memberDocumentId('site:document', bob)
    expect(aliceId).not.toBe(bobId)
    expect(sourceDocumentId(aliceId, alice)).toBe('site:document')
    expect(sourceDocumentId(aliceId, bob)).toBeNull()
    expect(sourceDocumentId(bobId, alice)).toBeNull()
    expect(sourceDocumentId('site:document', alice)).toBeNull()
  })

  it.each([undefined, '', ' ', 42])(
    'fails closed without a canonical member ID (%s)',
    (memberId) => {
      const context = { ...PER_MEMBER_LISTING_CONTEXT, memberId }
      expect(() => memberDocumentId('document', context)).toThrow('connector member ID')
      expect(() => sourceDocumentId('document', context)).toThrow('connector member ID')
    }
  )
})

function streamResponse(chunks: Uint8Array[], onCancel?: () => void): Response {
  let index = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++])
      } else {
        controller.close()
      }
    },
    cancel() {
      onCancel?.()
    },
  })
  return new Response(stream)
}

describe('readBodyWithLimit', () => {
  it('returns null as soon as the streamed cap is exceeded', async () => {
    const chunk = new Uint8Array(1024).fill(65)
    const onCancel = vi.fn()
    const result = await readBodyWithLimit(
      streamResponse([chunk, chunk, chunk, chunk], onCancel),
      2048
    )
    expect(result).toBeNull()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('does not materialize a bodyless response whose size is unknown', async () => {
    const arrayBuffer = vi.fn(async () => new Uint8Array(5000).buffer)
    // double-cast-allowed: minimal response stub exercising the no-stream branch
    const unknownSize = {
      body: null,
      arrayBuffer,
    } as unknown as Response
    expect(await readBodyWithLimit(unknownSize, 4096)).toBeNull()
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('uses a trusted content length to bound a bodyless response fallback', async () => {
    // double-cast-allowed: minimal response stub exercising the no-stream branch
    const within = {
      body: null,
      headers: new Headers({ 'content-length': '100' }),
      arrayBuffer: async () => new Uint8Array(100).buffer,
    } as unknown as Response
    expect((await readBodyWithLimit(within, 4096))?.byteLength).toBe(100)
  })
})

describe('Microsoft Graph traversal cursors', () => {
  it('rejects off-origin continuation URLs before they can receive a bearer token', () => {
    expect(() => assertMicrosoftGraphNextLink('https://evil.example/steal')).toThrow(
      /non-Microsoft Graph/
    )
    expect(() =>
      decodeMicrosoftGraphTraversalCursor(
        Buffer.from(
          JSON.stringify({
            folderStack: [],
            nextLink: 'https://evil.example/steal',
          })
        ).toString('base64'),
        'SharePoint'
      )
    ).toThrow(/non-Microsoft Graph/)
  })

  it('rejects invalid and oversized cursor members', () => {
    const encode = (state: unknown) => Buffer.from(JSON.stringify(state)).toString('base64')

    expect(() =>
      decodeMicrosoftGraphTraversalCursor(encode({ folderStack: [42] }), 'OneDrive')
    ).toThrow(/must be a string/)
    expect(() =>
      decodeMicrosoftGraphTraversalCursor(
        encode({ folderStack: ['x'.repeat(MICROSOFT_GRAPH_MAX_ITEM_ID_BYTES + 1)] }),
        'OneDrive'
      )
    ).toThrow(/size limit/)
    expect(() =>
      decodeMicrosoftGraphTraversalCursor(
        'x'.repeat(MICROSOFT_GRAPH_MAX_CURSOR_ENCODED_BYTES + 1),
        'OneDrive'
      )
    ).toThrow(/encoded state exceeds/)
  })

  it('enforces the pending-folder cap before mutating traversal state', () => {
    const pending = Array.from(
      { length: MICROSOFT_GRAPH_MAX_PENDING_FOLDERS },
      (_, index) => `folder-${index}`
    )

    expect(() => appendPendingMicrosoftGraphFolders(pending, ['overflow'], 'OneDrive')).toThrow(
      /Narrow the connector/
    )
    expect(pending).toHaveLength(MICROSOFT_GRAPH_MAX_PENDING_FOLDERS)
    expect(pending).not.toContain('overflow')
  })
})

describe('takeIndexableWithinCap', () => {
  const skip = (id: number) => ({ id, skip: true })
  const file = (id: number) => ({ id, skip: false })
  const isSkip = (i: { skip: boolean }) => i.skip

  it('does not count skipped items against the cap', () => {
    const res = takeIndexableWithinCap([skip(1), skip(2), file(3), file(4), file(5)], isSkip, 2, 0)
    // both skips + the first two files emitted; the third file is beyond the cap
    expect(res.documents.map((i) => i.id)).toEqual([1, 2, 3, 4])
    expect(res.indexableCount).toBe(2)
    expect(res.capReached).toBe(true)
  })

  it('keeps emitting indexable docs even when oversized files crowd the front', () => {
    // Regression guard: an oversized prefix must not starve the indexable budget.
    const res = takeIndexableWithinCap([skip(1), skip(2), skip(3), file(4), file(5)], isSkip, 2, 0)
    expect(res.documents.map((i) => i.id)).toEqual([1, 2, 3, 4, 5])
    expect(res.indexableCount).toBe(2)
    expect(res.capReached).toBe(true)
  })

  it('accounts for indexable docs already counted on previous pages', () => {
    const res = takeIndexableWithinCap([file(1), file(2), file(3)], isSkip, 5, 4)
    // only one indexable slot remains (5 - 4)
    expect(res.documents.map((i) => i.id)).toEqual([1])
    expect(res.indexableCount).toBe(1)
    expect(res.capReached).toBe(true)
  })
})

describe('htmlToPlainText entity decoding', () => {
  it('does not double-decode an escaped entity', () => {
    expect(htmlToPlainText('<p>&amp;#8217;</p>')).toBe('&#8217;')
  })

  it('does not double-decode a numerically escaped ampersand into a named entity', () => {
    expect(htmlToPlainText('<p>&#38;amp; &#x26;lt;</p>')).toBe('&amp; &lt;')
  })

  it('leaves NUL and other control references as literal text', () => {
    expect(htmlToPlainText('<p>a&#0;b&#1;c&#x7f;d</p>')).toBe('a&#0;b&#1;c&#x7f;d')
  })

  it('leaves malformed and out-of-range references as literal text', () => {
    expect(htmlToPlainText('<p>&#1114112; &#xD800; &#; &#x;</p>')).toBe(
      '&#1114112; &#xD800; &#; &#x;'
    )
  })
})

describe('isIndexableConnectorFile', () => {
  it('refuses legacy .ppt up front because no parser reads it', () => {
    expect(isIndexableConnectorFile('deck.ppt')).toBe(false)
  })

  /**
   * No bundled library extracts RTF. `DocParser`'s plaintext branch would accept
   * it and pass its control words through as prose, so it stays out of the set and
   * is reported as an unsupported extension instead.
   */
  it('rejects rtf rather than indexing its control words as prose', () => {
    expect(isIndexableConnectorFile('policy.rtf')).toBe(false)
  })
})

describe('extractConnectorText', () => {
  it('decodes a Latin-1 file as Windows-1252 instead of indexing mojibake', () => {
    expect(extractConnectorText(Buffer.from('Caf\xe9 \xa3 42', 'latin1'), 'notes.txt')).toBe(
      'Café £ 42'
    )
  })

  it('decodes UTF-16 with a BOM', () => {
    expect(
      extractConnectorText(
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<p>Hällo</p>', 'utf16le')]),
        'page.html'
      )
    ).toBe('Hällo')
  })
})

describe('hasIndexablePayload', () => {
  const bytes = (value: string) => ({
    bytes: Buffer.from(value),
    fileName: 'Report.pdf',
    mimeType: 'application/pdf',
  })

  /**
   * Observed in production: a zero-byte PDF was stored and shipped to OCR, which
   * answered `400 Bad Request` — an external call billed to discover the file was
   * empty, reported as an API fault rather than as an empty file. Before source
   * files existed this was dropped at the empty-content check.
   */
  it('rejects a zero-byte source file rather than sending it to OCR', () => {
    expect(hasIndexablePayload({ content: '', sourceFile: bytes('') })).toBe(false)
  })
})

describe('parseDefaultedUnlimitedSafeInteger', () => {
  const ERROR = 'bad cap'

  it('reads an explicit 0 as unlimited', () => {
    expect(parseDefaultedUnlimitedSafeInteger(0, 500, ERROR)).toBe(0)
    expect(parseDefaultedUnlimitedSafeInteger('0', 500, ERROR)).toBe(0)
  })

  it('parses a set cap and rejects a malformed one', () => {
    expect(parseDefaultedUnlimitedSafeInteger(' 200 ', 500, ERROR)).toBe(200)
    expect(() => parseDefaultedUnlimitedSafeInteger('many', 500, ERROR)).toThrow(ERROR)
    expect(() => parseDefaultedUnlimitedSafeInteger(-1, 500, ERROR)).toThrow(ERROR)
  })
})

describe('isSkippableMicrosoftGraphFolderError', () => {
  const unreachable = new ConnectorListingScopeUnavailableError('folder', 403)
  const perMember = { ...PER_MEMBER_LISTING_CONTEXT }

  it('never skips the configured root', () => {
    expect(isSkippableMicrosoftGraphFolderError(unreachable, perMember, true)).toBe(false)
  })

  it('never skips under a shared credential', () => {
    expect(isSkippableMicrosoftGraphFolderError(unreachable, {}, false)).toBe(false)
    expect(isSkippableMicrosoftGraphFolderError(unreachable, undefined, false)).toBe(false)
  })
})

describe('BoundedLines', () => {
  it('refuses a record that would cross the ceiling, whole, and says so in the output', () => {
    const lines = new BoundedLines(20)
    expect(lines.push('first')).toBe(true)
    expect(lines.push('--- header ---', 'a long body')).toBe(false)
    expect(lines.push('x')).toBe(false)
    expect(lines.join()).toBe('first\n[Truncated: the indexed text reached the size limit]')
  })

  it('counts encoded bytes, not characters', () => {
    const lines = new BoundedLines(6)
    expect(lines.push('éé')).toBe(true)
    expect(lines.push('é')).toBe(false)
  })

  describe('keeping the last records', () => {
    it('lets the oldest records go so the newest fit, under a header that stays', () => {
      const lines = new BoundedLines(24, 'last')
      lines.pin('# room')
      expect(lines.push('one')).toBe(true)
      expect(lines.push('two')).toBe(true)
      expect(lines.push('three')).toBe(true)
      expect(lines.push('four')).toBe(true)
      expect(lines.count).toBe(3)
      expect(lines.join()).toBe(
        '# room\n[Truncated: earlier text was left out to fit the size limit]\ntwo\nthree\nfour'
      )
    })

    it('refuses only a record that cannot fit on its own and carries on', () => {
      const lines = new BoundedLines(12, 'last')
      expect(lines.push('a very long record')).toBe(false)
      expect(lines.push('short')).toBe(true)
      expect(lines.push('next')).toBe(true)
      expect(lines.count).toBe(2)
      expect(lines.join()).toBe(
        '[Truncated: earlier text was left out to fit the size limit]\nshort\nnext'
      )
    })
  })
})

describe('looksLikeHtml', () => {
  it('does not mistake an address whose name starts like a tag for markup', () => {
    for (const text of ['Invite <a@acme.com>', 'From <b.smith@acme.com>', '<i.e. later>'])
      expect(looksLikeHtml(text)).toBe(false)
  })
})
