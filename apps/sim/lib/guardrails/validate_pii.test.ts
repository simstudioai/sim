/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { maskPIIBatch, validatePII } from '@/lib/guardrails/validate_pii'

const VALID_VIN = '1HGCM82633A004352'

interface Span {
  entity_type: string
  start: number
  end: number
  score: number
}

/** Mimic the Presidio anonymizer's default `replace`: each span → `<ENTITY_TYPE>`. */
function applyReplace(text: string, results: Span[]): string {
  let out = text
  for (const s of [...results].sort((a, b) => b.start - a.start)) {
    out = `${out.slice(0, s.start)}<${s.entity_type}>${out.slice(s.end)}`
  }
  return out
}

/** Analyzer mock: flags `a@b.com` as EMAIL_ADDRESS when that entity is in scope. */
function emailSpans(text: string, entities: string[] | undefined): Span[] {
  if (entities && !entities.includes('EMAIL_ADDRESS')) return []
  const idx = text.indexOf('a@b.com')
  return idx === -1 ? [] : [{ entity_type: 'EMAIL_ADDRESS', start: idx, end: idx + 7, score: 0.9 }]
}

describe('validate_pii (Presidio sidecars + TS VIN)', () => {
  let analyzeBodies: Array<{ text: string; entities?: string[] }>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    analyzeBodies = []
    fetchMock = vi.fn(async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body)
      if (url.includes('/analyze')) {
        analyzeBodies.push({ text: body.text, entities: body.entities })
        return new Response(JSON.stringify(emailSpans(body.text, body.entities)), { status: 200 })
      }
      // /anonymize
      return new Response(
        JSON.stringify({ text: applyReplace(body.text, body.analyzer_results) }),
        {
          status: 200,
        }
      )
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  describe('maskPIIBatch', () => {
    it('masks both Presidio entities and TS-detected VINs, preserving order', async () => {
      const out = await maskPIIBatch([`email a@b.com car ${VALID_VIN}`, 'nothing here'], [])
      expect(out[0]).toBe('email <EMAIL_ADDRESS> car <VIN>')
      expect(out[1]).toBe('nothing here')
    })

    it('strips VIN from the analyzer request (handled in TS)', async () => {
      await maskPIIBatch([`vin ${VALID_VIN} mail a@b.com`], ['EMAIL_ADDRESS', 'VIN'])
      expect(analyzeBodies[0].entities).toEqual(['EMAIL_ADDRESS'])
    })

    it('skips the analyzer entirely for a VIN-only request', async () => {
      const out = await maskPIIBatch([`vin ${VALID_VIN}`], ['VIN'])
      expect(out[0]).toBe('vin <VIN>')
      expect(analyzeBodies).toHaveLength(0)
    })

    it('returns [] for empty input and leaves empty strings untouched', async () => {
      expect(await maskPIIBatch([], [])).toEqual([])
      expect(await maskPIIBatch([''], [])).toEqual([''])
    })

    it('throws on a sidecar failure so the caller can scrub', async () => {
      fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }))
      await expect(maskPIIBatch(['email a@b.com'], [])).rejects.toThrow(/Presidio analyze failed/)
    })
  })

  describe('validatePII', () => {
    it('block mode fails with a summary when PII is detected', async () => {
      const res = await validatePII({
        text: `a@b.com and ${VALID_VIN}`,
        entityTypes: [],
        mode: 'block',
        requestId: 'r1',
      })
      expect(res.passed).toBe(false)
      expect(res.error).toContain('EMAIL_ADDRESS')
      expect(res.error).toContain('VIN')
      expect(res.detectedEntities).toHaveLength(2)
    })

    it('mask mode returns masked text', async () => {
      const res = await validatePII({
        text: `mail a@b.com vin ${VALID_VIN}`,
        entityTypes: [],
        mode: 'mask',
        requestId: 'r2',
      })
      expect(res.passed).toBe(true)
      expect(res.maskedText).toBe('mail <EMAIL_ADDRESS> vin <VIN>')
    })

    it('passes clean text', async () => {
      const res = await validatePII({
        text: 'nothing to see',
        entityTypes: [],
        mode: 'block',
        requestId: 'r3',
      })
      expect(res.passed).toBe(true)
      expect(res.detectedEntities).toHaveLength(0)
    })
  })
})
