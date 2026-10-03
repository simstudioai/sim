import { describe, expect, it } from 'vitest'
import { createOpenApiDownloadDocument } from '@/lib/openapi-download'

function collectReferences(value: unknown, references: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, references)
    return references
  }
  if (!value || typeof value !== 'object') return references

  for (const [key, item] of Object.entries(value)) {
    if (key === '$ref' && typeof item === 'string') references.push(item)
    collectReferences(item, references)
  }
  return references
}

function resolveReference(document: Record<string, unknown>, reference: string): unknown {
  return reference
    .replace('#/', '')
    .split('/')
    .reduce<unknown>((value, part) => {
      if (!value || typeof value !== 'object') return undefined
      return (value as Record<string, unknown>)[part]
    }, document)
}

describe('OpenAPI download', () => {
  it('combines every API domain into one document whose references all resolve', () => {
    const document = createOpenApiDownloadDocument()
    for (const reference of collectReferences(document)) {
      expect(reference).toMatch(/^#\//)
      expect(resolveReference(document, reference)).toBeDefined()
    }
  })
})
