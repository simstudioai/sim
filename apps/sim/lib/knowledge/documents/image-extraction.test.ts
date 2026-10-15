/**
 * @vitest-environment node
 */
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequest,
  mockResolveKey,
  mockAdmission,
  mockCooldown,
  mockLoad,
  mockSave,
  mockOnUsage,
} = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockResolveKey: vi.fn(),
  mockAdmission: vi.fn(),
  mockCooldown: vi.fn(),
  mockLoad: vi.fn(),
  mockSave: vi.fn(),
  mockOnUsage: vi.fn(),
}))

vi.mock('@/lib/knowledge/documents/image-extraction-gemini', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/knowledge/documents/image-extraction-gemini')>()),
  requestGeminiImageExtraction: mockRequest,
}))
vi.mock('@/lib/embeddings/keys', () => ({ resolveProviderKey: mockResolveKey }))
vi.mock('@/lib/core/rate-limiter/provider-admission', () => ({
  waitForProviderAdmission: mockAdmission,
  recordProviderCooldown: mockCooldown,
}))
vi.mock('@/lib/knowledge/documents/vision-checkpoints', () => ({
  createVisionCheckpoint: () => ({ load: mockLoad, save: mockSave }),
}))

import { env } from '@/lib/core/config/env'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import { EmbeddingConfigurationError } from '@/lib/embeddings/configuration-error'
import { extractImageText } from '@/lib/knowledge/documents/image-extraction'
import {
  DEFAULT_IMAGE_EXTRACTION_MODEL,
  GeminiImageExtractionError,
  resolveImageExtractionModel,
} from '@/lib/knowledge/documents/image-extraction-gemini'

const CHECKPOINT = { knowledgeBaseId: 'kb-1', documentId: 'doc-1', indexingPassId: 'pass-1' }

function extraction(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'table',
    language: 'en',
    visible_text: 'Region Quarter',
    description: 'A launch calendar.',
    table: { caption: '', headers: ['Region', 'Quarter'], rows: [['EMEA', 'Q1']], notes: '' },
    rendered_text: 'Region: EMEA. Quarter: Q1.',
    quality: { confidence: 0.98, issues: [], unreadable_regions: '' },
    ...overrides,
  }
}

function respond(body: unknown, finishReason = 'STOP') {
  mockRequest.mockResolvedValue({
    text: typeof body === 'string' ? body : JSON.stringify(body),
    finishReason,
    inputTokens: 1200,
    outputTokens: 300,
  })
}

/** A noisy image, so it stays over the byte floor at any tested size. */
async function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: '#808080',
      noise: { type: 'gaussian', mean: 128, sigma: 60 },
    },
  })
    .png()
    .toBuffer()
}

async function extract(width = 400, height = 300, extra: Record<string, unknown> = {}) {
  return extractImageText({
    source: await png(width, height),
    filename: 'Launch calendar',
    onUsage: mockOnUsage,
    ...extra,
  })
}

function reportedUsage() {
  expect(mockOnUsage).toHaveBeenCalledTimes(1)
  return mockOnUsage.mock.calls[0][0]
}

describe('extractImageText', () => {
  beforeEach(() => {
    mockLoad.mockResolvedValue(null)
    mockSave.mockResolvedValue(undefined)
    mockAdmission.mockResolvedValue(undefined)
    mockResolveKey.mockResolvedValue({ apiKey: 'platform-key', isBYOK: false })
    Object.assign(env, { KB_IMAGE_EXTRACTION_MODEL: undefined })
    respond(extraction())
  })

  it('keeps only the searchable text, with its cost, and checkpoints the result', async () => {
    const result = await extract(400, 300, { workspaceId: 'ws-1', checkpoint: CHECKPOINT })

    const usage = reportedUsage()
    expect(result).toMatchObject({ decorative: false, renderedText: 'Region: EMEA. Quarter: Q1.' })
    expect(usage).toMatchObject({
      model: DEFAULT_IMAGE_EXTRACTION_MODEL,
      inputTokens: 1200,
      outputTokens: 300,
    })
    expect(usage.cost).toBeGreaterThan(0)
    expect(mockRequest).toHaveBeenCalledTimes(1)
    // The checkpoint carries the same charge, so a resumed pass records it under the same key.
    expect(mockSave).toHaveBeenCalledWith({ ...result, usage }, undefined)
  })

  it('charges nothing when the workspace supplied its own Gemini key', async () => {
    mockResolveKey.mockResolvedValue({ apiKey: 'workspace-key', isBYOK: true })
    await extract()
    expect(reportedUsage().cost).toBe(0)
  })

  it('downscales an image wider than the model edge before sending it', async () => {
    await extract(4000, 1000)
    const sent = await sharp(
      Buffer.from(mockRequest.mock.calls[0][0].image.data, 'base64')
    ).metadata()
    expect(Math.max(sent.width ?? 0, sent.height ?? 0)).toBe(2048)
  })

  it('returns a decorative image with no text but keeps its cost', async () => {
    respond(extraction({ kind: 'decorative', rendered_text: 'Acme logo' }))
    expect(await extract(300, 120)).toMatchObject({ decorative: true, renderedText: '' })
    expect(reportedUsage().cost).toBeGreaterThan(0)
  })

  it('treats an image under the pixel floor as decorative without calling the model', async () => {
    expect(await extract(48, 400)).toEqual({ decorative: true, renderedText: '' })
    expect(mockRequest).not.toHaveBeenCalled()
    expect(mockOnUsage).not.toHaveBeenCalled()
  })

  it('resumes from a checkpoint without a second paid call', async () => {
    const cached = {
      decorative: false,
      renderedText: 'cached text',
      usage: {
        chargeId: 'charge-1',
        model: DEFAULT_IMAGE_EXTRACTION_MODEL,
        cost: 0.004,
        inputTokens: 1,
        outputTokens: 1,
      },
    }
    mockLoad.mockResolvedValue(cached)
    expect(await extract(400, 300, { checkpoint: CHECKPOINT })).toMatchObject({
      decorative: false,
      renderedText: 'cached text',
    })
    expect(mockRequest).not.toHaveBeenCalled()
    expect(reportedUsage()).toEqual(cached.usage)
  })

  it('refuses bytes that are not a supported raster image', async () => {
    await expect(
      extractImageText({
        source: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        filename: 'Logo',
      })
    ).rejects.toMatchObject({ code: 'invalid_file' })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('retries a malformed reply within the extraction and recovers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      mockRequest.mockResolvedValueOnce({
        text: '{"kind": "table", "rendered_text": "Region: EM',
        finishReason: 'STOP',
        inputTokens: 1200,
        outputTokens: 300,
      })
      const pending = extract()
      await vi.waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1))
      await vi.advanceTimersByTimeAsync(10_000)
      /** Both replies were billed by Gemini, so the usage covers both. */
      await expect(pending).resolves.toMatchObject({ decorative: false })
      expect(reportedUsage()).toMatchObject({ inputTokens: 2400, outputTokens: 600 })
      expect(mockRequest).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails permanently once every in-call attempt was malformed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      respond('{"kind": "table", "rendered_text": "Region: EM')
      const pending = extract().catch((error: unknown) => error)
      await vi.waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1))
      for (let attempt = 0; attempt < 3; attempt++) await vi.advanceTimersByTimeAsync(10_000)
      expect(await pending).toMatchObject({ code: 'image_extraction_invalid' })
      expect(mockRequest).toHaveBeenCalledTimes(4)
      const usage = reportedUsage()
      expect(usage).toMatchObject({ inputTokens: 4800, outputTokens: 1200 })
      expect(usage.cost).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails an incomplete or empty reply permanently without retrying', async () => {
    respond({ kind: 'table' })
    await expect(extract()).rejects.toMatchObject({ code: 'image_extraction_invalid' })

    respond('', 'SAFETY')
    await expect(extract()).rejects.toMatchObject({ code: 'image_extraction_invalid' })

    respond('{"kind": "scan", "rendered_text": "Chapter one', 'RECITATION')
    await expect(extract()).rejects.toMatchObject({ code: 'image_extraction_invalid' })
    expect(mockRequest).toHaveBeenCalledTimes(3)
  })

  it('fails a response cut off at the token limit instead of paying for retries', async () => {
    respond('{"kind": "table", "rendered_text": "Region: EMEA', 'MAX_TOKENS')
    await expect(extract()).rejects.toMatchObject({ code: 'image_extraction_invalid' })
    expect(mockRequest).toHaveBeenCalledTimes(1)
  })

  it('defers on throttling and fails on a rejected key or image', async () => {
    mockRequest.mockRejectedValueOnce(new GeminiImageExtractionError(429, 5000, ''))
    await expect(extract()).rejects.toMatchObject({ reason: 'rate_limit', retryAfterMs: 5000 })
    /** The whole key backs off, not only this document. */
    expect(mockCooldown).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'vision' }),
      5000
    )

    mockRequest.mockRejectedValueOnce(new GeminiImageExtractionError(403, undefined, ''))
    await expect(extract()).rejects.toMatchObject({ code: 'image_extraction_unavailable' })

    mockRequest.mockRejectedValueOnce(new GeminiImageExtractionError(400, undefined, ''))
    await expect(extract()).rejects.toMatchObject({ code: 'invalid_file' })

    mockRequest.mockRejectedValueOnce(
      new GeminiImageExtractionError(400, undefined, 'INVALID_ARGUMENT API_KEY_INVALID')
    )
    await expect(extract()).rejects.toMatchObject({ code: 'image_extraction_unavailable' })

    mockRequest.mockRejectedValueOnce(new GeminiImageExtractionError(404, undefined, ''))
    await expect(extract()).rejects.toMatchObject({ code: 'image_extraction_unavailable' })

    const unexpected = new GeminiImageExtractionError(501, undefined, '')
    mockRequest.mockRejectedValueOnce(unexpected)
    await expect(extract()).rejects.toBe(unexpected)
    /** One call per failure above: none of them is retried within the extraction. */
    expect(mockRequest).toHaveBeenCalledTimes(6)
    expect(mockOnUsage).not.toHaveBeenCalled()
  })

  it('retries a transient Gemini server error within the same extraction', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      mockRequest.mockRejectedValueOnce(new GeminiImageExtractionError(500, undefined, ''))
      const pending = extract()
      await vi.waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1))
      await vi.advanceTimersByTimeAsync(10_000)
      await expect(pending).resolves.toMatchObject({ decorative: false })
      expect(mockRequest).toHaveBeenCalledTimes(2)
      expect(mockAdmission).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('yields to the next pass instead of starting a call that would overrun the deadline', async () => {
    await expect(extract(400, 300, { deadlineAt: Date.now() + 10_000 })).rejects.toBeInstanceOf(
      ProviderCapacityDeferredError
    )
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('keeps the post-call reserve when the admission wait eats into the budget', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const deadlineAt = Date.now() + 200_000
      mockAdmission.mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + 10_000)
      })
      await expect(extract(400, 300, { deadlineAt })).rejects.toBeInstanceOf(
        ProviderCapacityDeferredError
      )
      expect(mockAdmission.mock.calls[0][0].maxWaitMs).toBeLessThanOrEqual(5_000)
      expect(mockRequest).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats an image under the byte floor as decorative without a call', async () => {
    const tiny = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer()
    expect(tiny.length).toBeLessThan(2048)
    await expect(
      extractImageText({ source: tiny, filename: 'spacer.png', workspaceId: 'ws-1' })
    ).resolves.toEqual({ decorative: true, renderedText: '' })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('fails an image whose pixel data cannot be decoded as invalid', async () => {
    /** Wider than the model edge, so the pixels are decoded for downscaling. */
    const valid = await png(2100, 64)
    const corrupt = Buffer.concat([valid.subarray(0, 64), Buffer.alloc(valid.length - 64, 7)])
    await expect(
      extractImageText({ source: corrupt, filename: 'broken.png', workspaceId: 'ws-1' })
    ).rejects.toMatchObject({ code: 'invalid_file' })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('fails with an actionable error when no Gemini key is configured', async () => {
    mockResolveKey.mockRejectedValue(new EmbeddingConfigurationError())
    await expect(extract()).rejects.toMatchObject({ code: 'image_extraction_unavailable' })
    expect(mockRequest).not.toHaveBeenCalled()
  })
})

describe('resolveImageExtractionModel', () => {
  afterEach(() => {
    Object.assign(env, { KB_IMAGE_EXTRACTION_MODEL: undefined })
  })

  it.each(['not-a-model', 'gpt-5.4-mini', 'gemini-does-not-exist', 'gemini-2.5-flash'])(
    'falls back to the default for %s',
    (model) => {
      Object.assign(env, { KB_IMAGE_EXTRACTION_MODEL: model })
      expect(resolveImageExtractionModel()).toBe(DEFAULT_IMAGE_EXTRACTION_MODEL)
    }
  )

  it('uses a configured Gemini model', () => {
    Object.assign(env, { KB_IMAGE_EXTRACTION_MODEL: 'gemini-3.1-pro-preview' })
    expect(resolveImageExtractionModel()).toBe('gemini-3.1-pro-preview')
  })
})
