/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { maskPIIBatch, validatePII } from '@/lib/guardrails/validate_pii'

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

describe('validate_pii (Presidio sidecar)', () => {
  let analyzeBodies: Array<{ text: string; language: string; entities?: string[] }>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    analyzeBodies = []
    fetchMock = vi.fn(async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body)
      if (url.includes('/analyze_batch')) {
        for (const text of body.texts as string[]) {
          analyzeBodies.push({ text, language: body.language, entities: body.entities })
        }
        const spans = (body.texts as string[]).map((t) => emailSpans(t, body.entities))
        return new Response(JSON.stringify(spans), { status: 200 })
      }
      if (url.includes('/anonymize_batch')) {
        const texts = (body.items as Array<{ text: string; analyzer_results: Span[] }>).map((i) =>
          applyReplace(i.text, i.analyzer_results)
        )
        return new Response(JSON.stringify({ texts }), { status: 200 })
      }
      if (url.includes('/analyze')) {
        analyzeBodies.push({ text: body.text, language: body.language, entities: body.entities })
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
    it('masks detected entities, preserving input order', async () => {
      const out = await maskPIIBatch(['email a@b.com', 'nothing here'], [])
      expect(out[0]).toBe('email <EMAIL_ADDRESS>')
      expect(out[1]).toBe('nothing here')
    })

    it('forwards entityTypes (and language) to the analyzer; empty ⇒ omitted (all)', async () => {
      await maskPIIBatch(['mail a@b.com'], ['EMAIL_ADDRESS', 'PERSON'], 'es')
      expect(analyzeBodies[0].entities).toEqual(['EMAIL_ADDRESS', 'PERSON'])
      expect(analyzeBodies[0].language).toBe('es')

      analyzeBodies.length = 0
      await maskPIIBatch(['mail a@b.com'], [])
      expect(analyzeBodies[0].entities).toBeUndefined()
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
        text: 'reach me at a@b.com',
        entityTypes: [],
        mode: 'block',
        requestId: 'r1',
      })
      expect(res.passed).toBe(false)
      expect(res.error).toContain('EMAIL_ADDRESS')
      expect(res.detectedEntities).toHaveLength(1)
    })

    it('mask mode returns masked text', async () => {
      const res = await validatePII({
        text: 'mail a@b.com',
        entityTypes: [],
        mode: 'mask',
        requestId: 'r2',
      })
      expect(res.passed).toBe(true)
      expect(res.maskedText).toBe('mail <EMAIL_ADDRESS>')
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
