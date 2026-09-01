/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWithRetry } = vi.hoisted(() => ({ mockFetchWithRetry: vi.fn() }))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: mockFetchWithRetry,
  VALIDATE_RETRY_OPTIONS: {},
}))

import { parseVtt, zoomConnector } from '@/connectors/zoom/zoom'

const HEADER = 'WEBVTT\n\n'

describe('parseVtt', () => {
  it.concurrent('returns empty string for input with no cues', () => {
    expect(parseVtt(HEADER)).toBe('')
  })

  it.concurrent('extracts plain spoken text from a single cue', () => {
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\nHello world\n`
    expect(parseVtt(vtt)).toBe('Hello world')
  })

  it.concurrent('preserves WebVTT voice tags as "Speaker: text"', () => {
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\n<v Alice>hello there</v>\n`
    expect(parseVtt(vtt)).toBe('Alice: hello there')
  })

  it.concurrent('preserves voice tags with class suffix', () => {
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\n<v.host Bob>welcome</v>\n`
    expect(parseVtt(vtt)).toBe('Bob: welcome')
  })

  it.concurrent('strips inline formatting tags but keeps text', () => {
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\n<b>bold</b> and <i>italic</i>\n`
    expect(parseVtt(vtt)).toBe('bold and italic')
  })

  it.concurrent('strips karaoke timestamp tags', () => {
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\nhello <00:00:01.000>world\n`
    expect(parseVtt(vtt)).toBe('hello world')
  })

  it.concurrent('strips class spans', () => {
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\n<c.loud>SHOUT</c>\n`
    expect(parseVtt(vtt)).toBe('SHOUT')
  })

  it.concurrent('skips cue identifier lines before timing', () => {
    const vtt = `${HEADER}cue-1\n00:00:00.000 --> 00:00:02.000\nhello\n`
    expect(parseVtt(vtt)).toBe('hello')
  })

  it.concurrent('joins multiple cues with newlines', () => {
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\nfirst\n\n00:00:02.000 --> 00:00:04.000\nsecond\n`
    expect(parseVtt(vtt)).toBe('first\nsecond')
  })

  it.concurrent('collapses repeated whitespace within a cue', () => {
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\nhello   world\n`
    expect(parseVtt(vtt)).toBe('hello world')
  })

  it.concurrent('iteratively strips overlapping tags that reconstruct after one pass', () => {
    const crafted = '<<b>b>injected</<b>b>'
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\n${crafted}\n`
    const result = parseVtt(vtt)
    expect(result).not.toMatch(/<\/?[^>]+>/)
    expect(result).toContain('injected')
  })

  it.concurrent('iteratively strips nested script-like tag fragments', () => {
    const crafted = '<scr<script>ipt>alert(1)</scr</script>ipt>'
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\n${crafted}\n`
    const result = parseVtt(vtt)
    expect(result).not.toMatch(/<\/?[^>]+>/)
    expect(result.toLowerCase()).not.toContain('script')
  })

  it.concurrent('sanitizes crafted speaker names that embed tag fragments', () => {
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\n<v <b>Evil</b>>payload</v>\n`
    const result = parseVtt(vtt)
    expect(result).not.toMatch(/<\/?[^>]+>/)
  })

  it.concurrent('terminates on adversarial deeply-nested input', () => {
    const crafted = `${'<'.repeat(50)}b${'>'.repeat(50)}text${'<'.repeat(50)}/b${'>'.repeat(50)}`
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\n${crafted}\n`
    const result = parseVtt(vtt)
    expect(result).not.toMatch(/<\/?[^>]+>/)
  })
})

function recording(uuid: string) {
  return {
    uuid,
    id: 1,
    topic: `Meeting ${uuid}`,
    start_time: '2024-01-01T00:00:00Z',
    recording_files: [
      {
        id: `f-${uuid}`,
        file_type: 'TRANSCRIPT',
        status: 'completed',
        file_size: 1024,
        download_url: `https://acme.zoom.us/rec/download/${uuid}`,
      },
    ],
  }
}

/** Answers the recordings listing with a fixed body. */
function mockListing(body: Record<string, unknown>) {
  mockFetchWithRetry.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  })
}

describe('zoomConnector.listDocuments cap accounting', () => {
  beforeEach(() => {
    mockFetchWithRetry.mockReset()
  })

  it('does not cap the listing when the source is exhausted exactly at the limit', async () => {
    mockListing({ meetings: [recording('a'), recording('b')] })

    const syncContext: Record<string, unknown> = {}
    const result = await zoomConnector.listDocuments(
      'tok',
      { maxRecordings: '2', lookback: '30' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(2)
    expect(result.hasMore).toBe(false)
    // Nothing was withheld, so deletion reconciliation must stay enabled.
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('caps the listing when recordings are trimmed off the page', async () => {
    mockListing({ meetings: [recording('a'), recording('b'), recording('c')] })

    const syncContext: Record<string, unknown> = {}
    const result = await zoomConnector.listDocuments(
      'tok',
      { maxRecordings: '2', lookback: '30' },
      undefined,
      syncContext
    )

    expect(result.documents.map((d) => d.externalId)).toEqual(['a', 'b'])
    expect(syncContext.listingCapped).toBe(true)
  })

  it('caps the listing when a further page remains behind the cap', async () => {
    mockListing({ meetings: [recording('a'), recording('b')], next_page_token: 'tok-2' })

    const syncContext: Record<string, unknown> = {}
    await zoomConnector.listDocuments(
      'tok',
      { maxRecordings: '2', lookback: '30' },
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBe(true)
  })

  it('caps the listing when a further window remains behind the cap', async () => {
    mockListing({ meetings: [recording('a'), recording('b')] })

    const syncContext: Record<string, unknown> = {}
    await zoomConnector.listDocuments(
      'tok',
      { maxRecordings: '2', lookback: '180' },
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBe(true)
  })
})
