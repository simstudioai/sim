/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { normalizeExpenseDocuments } from '@/app/api/tools/textract/analyze-expense/route'

describe('normalizeExpenseDocuments', () => {
  it('maps a documented AWS AnalyzeExpense response shape', () => {
    const result = normalizeExpenseDocuments([
      {
        ExpenseIndex: 1,
        SummaryFields: [
          {
            Type: { Text: 'VENDOR_NAME', Confidence: 98.1 },
            ValueDetection: { Text: 'Acme Corp', Confidence: 97.5 },
            LabelDetection: { Text: 'Vendor', Confidence: 90 },
            PageNumber: 1,
            Currency: { Code: 'USD', Confidence: 95 },
            GroupProperties: [{ Id: 'g1', Types: ['VENDOR'] }],
          },
        ],
        LineItemGroups: [
          {
            LineItemGroupIndex: 1,
            LineItems: [
              {
                LineItemExpenseFields: [
                  {
                    Type: { Text: 'ITEM', Confidence: 91 },
                    ValueDetection: { Text: 'Widget', Confidence: 93 },
                  },
                ],
              },
            ],
          },
        ],
      },
    ])

    expect(result).toEqual([
      {
        expenseIndex: 1,
        summaryFields: [
          {
            type: { text: 'VENDOR_NAME', confidence: 98.1 },
            valueDetection: { text: 'Acme Corp', confidence: 97.5 },
            labelDetection: { text: 'Vendor', confidence: 90 },
            pageNumber: 1,
            currency: { code: 'USD', confidence: 95 },
            groupProperties: [{ id: 'g1', types: ['VENDOR'] }],
          },
        ],
        lineItemGroups: [
          {
            lineItemGroupIndex: 1,
            lineItems: [
              {
                lineItemExpenseFields: [
                  {
                    type: { text: 'ITEM', confidence: 91 },
                    valueDetection: { text: 'Widget', confidence: 93 },
                    labelDetection: undefined,
                    pageNumber: undefined,
                    currency: undefined,
                    groupProperties: undefined,
                  },
                ],
              },
            ],
          },
        ],
      },
    ])
  })

  it('defaults missing arrays to empty arrays', () => {
    expect(normalizeExpenseDocuments([{ ExpenseIndex: 0 }])).toEqual([
      { expenseIndex: 0, summaryFields: [], lineItemGroups: [] },
    ])
  })
})
