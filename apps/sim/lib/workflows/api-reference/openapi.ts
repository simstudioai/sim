import type { ApiReferenceDoc, ApiReferenceEntry } from '@/lib/workflows/api-reference/types'

/**
 * Minimal OpenAPI 3.1 document for a workspace's published workflows. It falls out
 * cheaply because we already hold JSON Schema for every input/output — each entry
 * becomes one `POST {invokeUrl}` operation. Intentionally not exhaustive (no auth
 * scheme wiring beyond a description, no error responses); it is a convenience render,
 * and the JSON doc remains the source of truth.
 */
export function renderDocOpenApi(doc: ApiReferenceDoc): Record<string, unknown> {
  const paths: Record<string, unknown> = {}

  for (const entry of doc.entries) {
    const path = new URL(entry.invokeUrl).pathname
    paths[path] = {
      post: buildOperation(entry),
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: `${doc.name} — API Reference`,
      version: '1.0.0',
      description: `Published workflow endpoints for workspace ${doc.workspaceId}. Generated ${doc.generatedAt}.`,
    },
    paths,
  }
}

function buildOperation(entry: ApiReferenceEntry): Record<string, unknown> {
  return {
    operationId: `invoke_${entry.workflowId}`,
    summary: entry.summary ?? entry.name,
    description: [entry.description, `Auth: ${entry.auth.description}`]
      .filter(Boolean)
      .join('\n\n'),
    requestBody: {
      required: true,
      content: { 'application/json': { schema: entry.input } },
    },
    responses: {
      '200': {
        description: 'Workflow output',
        content: { 'application/json': { schema: entry.output } },
      },
    },
  }
}
