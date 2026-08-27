/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getAzureMistralOcrRequestPolicy,
  MISTRAL_OCR_REQUEST_POLICY,
} from '@/lib/knowledge/documents/ocr-request-policy'

describe('OCR request policies', () => {
  it('uses Mistral hosted OCR limits without binary-megabyte inflation', () => {
    expect(MISTRAL_OCR_REQUEST_POLICY).toMatchObject({
      maxBytes: 50_000_000,
      maxPages: 1000,
      concurrency: 2,
    })
  })

  it('preserves the historical Azure model envelope', () => {
    expect(getAzureMistralOcrRequestPolicy('mistral-ocr-2503')).toMatchObject({
      maxBytes: 50_000_000,
      maxPages: 1000,
      concurrency: 1,
    })
    expect(getAzureMistralOcrRequestPolicy('mistral-ocr')).toMatchObject({
      maxBytes: 50_000_000,
      maxPages: 1000,
      concurrency: 1,
    })
  })

  it('uses the stricter current Azure envelope for current and unknown models', () => {
    for (const modelName of [
      'mistral-document-ai-2512',
      'mistral-ocr-4-0',
      'custom-deployment-name',
    ]) {
      expect(getAzureMistralOcrRequestPolicy(modelName)).toMatchObject({
        maxBytes: 30_000_000,
        maxPages: 30,
        concurrency: 1,
      })
    }
  })
})
