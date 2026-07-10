import type { McpTransport } from '@/lib/mcp/types'

export interface McpServerTemplate {
  id: string
  name: string
  description: string
  transport: McpTransport
  url: string
  headers: readonly {
    key: string
    value: string
  }[]
  timeout: number
}

export const MCP_SERVER_TEMPLATES = [
  {
    id: 'unstructured-transform',
    name: 'Unstructured Transform',
    description:
      'Convert PDFs, DOCX, PPTX, HTML, and images into clean markdown, JSON, HTML, or text with OCR and RAG preprocessing.',
    transport: 'streamable-http',
    url: 'https://mcp.transform.unstructured.io',
    headers: [{ key: 'Authorization', value: 'Bearer {{UNSTRUCTURED_API_KEY}}' }],
    timeout: 30000,
  },
] as const satisfies readonly McpServerTemplate[]

export function buildHeadersFromTemplate(template: McpServerTemplate) {
  return [...template.headers.map((header) => ({ ...header })), { key: '', value: '' }]
}
