import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createOpenAPI } from 'fumadocs-openapi/server'

const SPEC_FILES = [
  'openapi-core.json',
  'openapi-v2-logs.json',
  'openapi-v2-workflows.json',
  'openapi-v2-tables.json',
  'openapi-v2-knowledge.json',
  'openapi-v2-files-audit.json',
] as const

export const openapi = createOpenAPI({
  input: SPEC_FILES.map((file) => `./${file}`),
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

function resolveRefs(
  obj: unknown,
  spec: Record<string, unknown>,
  seen: Set<string> = new Set(),
  depth = 0
): unknown {
  // Generous backstop against pathological fan-out; real schemas nest far shallower.
  if (depth > 50) return obj
  if (Array.isArray(obj)) {
    return obj.map((item) => resolveRefs(item, spec, seen, depth + 1))
  }
  if (obj && typeof obj === 'object') {
    const record = obj as Record<string, unknown>
    if (typeof record.$ref === 'string') {
      const ref = record.$ref
      // Break reference cycles: if this $ref is already being expanded above us,
      // leave it untouched instead of recursing forever.
      if (seen.has(ref)) return record
      const resolved = resolveRef(ref, spec)
      if (resolved === undefined) return record
      seen.add(ref)
      const out = resolveRefs(resolved, spec, seen, depth + 1)
      seen.delete(ref)
      return out
    }
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      result[key] = resolveRefs(value, spec, seen, depth + 1)
    }
    return result
  }
  return obj
}

function formatSchema(schema: unknown): string {
  return JSON.stringify(schema, null, 2)
}

let cachedSpecs: Record<string, unknown>[] | null = null

function getSpecs(): Record<string, unknown>[] {
  if (!cachedSpecs) {
    cachedSpecs = SPEC_FILES.map(
      (file) =>
        JSON.parse(readFileSync(join(process.cwd(), file), 'utf8')) as Record<string, unknown>
    )
  }
  return cachedSpecs
}

/**
 * Locate an operation by path + method across every rendered spec, returning the
 * operation together with the spec that owns it so `$ref`s resolve within the
 * correct document (each spec carries its own `components`).
 */
function findOperation(
  path: string,
  method: string
): { operation: Record<string, unknown>; spec: Record<string, unknown> } | undefined {
  const key = method.toLowerCase()
  for (const spec of getSpecs()) {
    const pathObj = (spec.paths as Record<string, Record<string, unknown>> | undefined)?.[path]
    const operation = pathObj?.[key] as Record<string, unknown> | undefined
    if (operation) return { operation, spec }
  }
  return undefined
}

export function getApiSpecContent(
  title: string,
  description: string | undefined,
  operations: OpenAPIOperation[]
): string {
  if (!operations || operations.length === 0) {
    return `# ${title}\n\n${description || ''}`
  }

  const op = operations[0]
  const method = op.method.toUpperCase()
  const found = findOperation(op.path, op.method)

  if (!found) {
    return `# ${title}\n\n${description || ''}`
  }

  const resolved = resolveRefs(found.operation, found.spec) as Record<string, unknown>
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
