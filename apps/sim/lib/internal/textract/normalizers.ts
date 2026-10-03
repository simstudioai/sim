import type { ExpenseDocument, IdentityDocument } from '@aws-sdk/client-textract'

export function normalizeExpenseField(field: {
  Type?: { Text?: string; Confidence?: number }
  ValueDetection?: { Text?: string; Confidence?: number }
  LabelDetection?: { Text?: string; Confidence?: number }
  PageNumber?: number
  Currency?: { Code?: string; Confidence?: number }
  GroupProperties?: { Id?: string; Types?: string[] }[]
}) {
  return {
    type: { text: field.Type?.Text, confidence: field.Type?.Confidence },
    valueDetection: {
      text: field.ValueDetection?.Text,
      confidence: field.ValueDetection?.Confidence,
    },
    labelDetection: field.LabelDetection
      ? { text: field.LabelDetection.Text, confidence: field.LabelDetection.Confidence }
      : undefined,
    pageNumber: field.PageNumber,
    currency: field.Currency
      ? { code: field.Currency.Code, confidence: field.Currency.Confidence }
      : undefined,
    groupProperties: field.GroupProperties?.map((group) => ({
      id: group.Id ?? '',
      types: group.Types ?? [],
    })),
  }
}

export function normalizeExpenseDocuments(documents: ExpenseDocument[]) {
  return documents.map((document) => ({
    expenseIndex: document.ExpenseIndex,
    summaryFields: (document.SummaryFields ?? []).map(normalizeExpenseField),
    lineItemGroups: (document.LineItemGroups ?? []).map((group) => ({
      lineItemGroupIndex: group.LineItemGroupIndex,
      lineItems: (group.LineItems ?? []).map((item) => ({
        lineItemExpenseFields: (item.LineItemExpenseFields ?? []).map(normalizeExpenseField),
      })),
    })),
  }))
}

export function normalizeIdentityDocuments(documents: IdentityDocument[]) {
  return documents.map((document) => ({
    documentIndex: document.DocumentIndex,
    identityDocumentFields: (document.IdentityDocumentFields ?? []).map((field) => ({
      type: {
        text: field.Type?.Text,
        confidence: field.Type?.Confidence,
        normalizedValue: field.Type?.NormalizedValue
          ? {
              value: field.Type.NormalizedValue.Value,
              valueType: field.Type.NormalizedValue.ValueType,
            }
          : undefined,
      },
      valueDetection: {
        text: field.ValueDetection?.Text,
        confidence: field.ValueDetection?.Confidence,
        normalizedValue: field.ValueDetection?.NormalizedValue
          ? {
              value: field.ValueDetection.NormalizedValue.Value,
              valueType: field.ValueDetection.NormalizedValue.ValueType,
            }
          : undefined,
      },
    })),
  }))
}
