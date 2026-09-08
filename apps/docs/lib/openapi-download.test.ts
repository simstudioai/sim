import { describe, expect, it } from 'vitest'
import { createOpenApiDownloadDocument } from '@/lib/openapi-download'
import { GET } from '@/app/openapi.json/route'

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
  it('combines every API domain into one OpenAPI document', () => {
    const document = createOpenApiDownloadDocument()
    const paths = document.paths as Record<string, unknown>
    const tags = document.tags as Array<{ name: string }>

    expect(document.openapi).toBe('3.1.0')
    expect(Object.keys(paths)).toHaveLength(133)
    expect(tags.map((tag) => tag.name)).toEqual([
      'Workflows',
      'Workflow Runs',
      'Logs',
      'Files',
      'Audit Logs',
      'Tables',
      'Knowledge Bases',
      'Billing',
      'Meta',
      'Workspaces',
      'MCP Servers',
      'Skills',
      'Custom Tools',
      'Sandboxes',
      'Credentials',
      'Secrets',
      'Catalog',
    ])
    for (const reference of collectReferences(document)) {
      expect(reference).toMatch(/^#\//)
      expect(resolveReference(document, reference)).toBeDefined()
    }
  })

  it('serves the document as a named JSON download', async () => {
    const response = GET()
    const document = await response.json()

    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="sim-openapi-v2.json"'
    )
    expect(document.info.title).toBe('Sim API v2')
  })
})
