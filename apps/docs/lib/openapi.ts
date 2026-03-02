import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createOpenAPI } from 'fumadocs-openapi/server'

export const openapi = createOpenAPI({
  input: ['./openapi.json'],
})

interface OpenAPIOperation {
  path: string
  method: string
}

function resolveRef(ref: string, spec: Record<string, unknown>): unknown {
  const parts = ref.replace('#/', '').split('/')
  let current: unknown = spec
  for (const part of parts) {
    if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }
  return current
}

function resolveRefs(obj: unknown, spec: Record<string, unknown>, depth = 0): unknown {
  if (depth > 10) return obj
  if (Array.isArray(obj)) {
    return obj.map((item) => resolveRefs(item, spec, depth + 1))
  }
  if (obj && typeof obj === 'object') {
    const record = obj as Record<string, unknown>
    if ('$ref' in record && typeof record.$ref === 'string') {
      const resolved = resolveRef(record.$ref, spec)
      return resolveRefs(resolved, spec, depth + 1)
    }
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      result[key] = resolveRefs(value, spec, depth + 1)
    }
    return result
  }
  return obj
}

function formatSchema(schema: unknown): string {
  return JSON.stringify(schema, null, 2)
}

let cachedSpec: Record<string, unknown> | null = null

function getSpec(): Record<string, unknown> {
  if (!cachedSpec) {
    const specPath = join(process.cwd(), 'openapi.json')
    cachedSpec = JSON.parse(readFileSync(specPath, 'utf8')) as Record<string, unknown>
  }
  return cachedSpec
}

export function getApiSpecContent(
  title: string,
  description: string | undefined,
  operations: OpenAPIOperation[]
): string {
  const spec = getSpec()

  if (!operations || operations.length === 0) {
    return `# ${title}\n\n${description || ''}`
  }

  const op = operations[0]
  const method = op.method.toUpperCase()
  const pathObj = (spec.paths as Record<string, Record<string, unknown>>)?.[op.path]
  const operation = pathObj?.[op.method.toLowerCase()] as Record<string, unknown> | undefined

  if (!operation) {
    return `# ${title}\n\n${description || ''}`
  }

  const resolved = resolveRefs(operation, spec) as Record<string, unknown>
  const lines: string[] = []

  lines.push(`# ${title}`)
  lines.push(`\`${method} ${op.path}\``)

  if (resolved.description) {
    lines.push(`## Description\n${resolved.description}`)
  }

  const parameters = resolved.parameters as Array<Record<string, unknown>> | undefined
  if (parameters && parameters.length > 0) {
    lines.push('## Parameters')
    for (const param of parameters) {
      const required = param.required ? ' (required)' : ''
      const schemaType = param.schema
        ? ` — \`${(param.schema as Record<string, unknown>).type || 'string'}\``
        : ''
      lines.push(
        `- **${param.name}** (${param.in})${required}${schemaType}: ${param.description || ''}`
      )
    }
  }

  const requestBody = resolved.requestBody as Record<string, unknown> | undefined
  if (requestBody) {
    lines.push('## Request Body')
    if (requestBody.description) {
      lines.push(String(requestBody.description))
    }
    const content = requestBody.content as Record<string, Record<string, unknown>> | undefined
    const jsonContent = content?.['application/json']
    if (jsonContent?.schema) {
      lines.push(`\`\`\`json\n${formatSchema(jsonContent.schema)}\n\`\`\``)
    }
  }

  const responses = resolved.responses as Record<string, Record<string, unknown>> | undefined
  if (responses) {
    lines.push('## Responses')
    for (const [status, response] of Object.entries(responses)) {
      lines.push(`### ${status} — ${response.description || ''}`)
      const content = response.content as Record<string, Record<string, unknown>> | undefined
      const jsonContent = content?.['application/json']
      if (jsonContent?.schema) {
        lines.push(`\`\`\`json\n${formatSchema(jsonContent.schema)}\n\`\`\``)
      }
    }
  }

  return lines.join('\n\n')
}
