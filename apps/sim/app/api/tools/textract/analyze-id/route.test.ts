/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { normalizeIdentityDocuments } from '@/app/api/tools/textract/analyze-id/route'

describe('normalizeIdentityDocuments', () => {
  it('maps a documented AWS AnalyzeID response shape', () => {
    const result = normalizeIdentityDocuments([
      {
        DocumentIndex: 1,
        IdentityDocumentFields: [
          {
            Type: { Text: 'FIRST_NAME', Confidence: 99 },
            ValueDetection: { Text: 'Jane', Confidence: 98 },
          },
          {
            Type: {
              Text: 'DATE_OF_BIRTH',
              Confidence: 97,
              NormalizedValue: { Value: '1990-01-01', ValueType: 'Date' },
            },
            ValueDetection: {
              Text: '01/01/1990',
              Confidence: 96,
              NormalizedValue: { Value: '1990-01-01T00:00:00', ValueType: 'Date' },
            },
          },
        ],
      },
    ])

    expect(result).toEqual([
      {
        documentIndex: 1,
        identityDocumentFields: [
          {
            type: { text: 'FIRST_NAME', confidence: 99, normalizedValue: undefined },
            valueDetection: { text: 'Jane', confidence: 98, normalizedValue: undefined },
          },
          {
            type: {
              text: 'DATE_OF_BIRTH',
              confidence: 97,
              normalizedValue: { value: '1990-01-01', valueType: 'Date' },
            },
            valueDetection: {
              text: '01/01/1990',
              confidence: 96,
              normalizedValue: { value: '1990-01-01T00:00:00', valueType: 'Date' },
            },
          },
        ],
      },
    ])
  })

  it('defaults missing fields to an empty array', () => {
    expect(normalizeIdentityDocuments([{ DocumentIndex: 0 }])).toEqual([
      { documentIndex: 0, identityDocumentFields: [] },
    ])
  })
})
