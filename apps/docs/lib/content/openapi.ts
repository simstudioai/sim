import { isRecordLike, toArray, toRecord } from '@sim/utils/object'
import type { DocsPage, OperationReference } from '@/lib/content/types'
import { OPENAPI_DOCUMENTS_BY_FILE } from '@/lib/openapi-documents'
import { OPENAPI_SPEC_FILES } from '@/lib/openapi-specs'

const HTTP_METHODS = ['get', 'post', 'patch', 'delete', 'head', 'put', 'options', 'trace'] as const

export interface RequestSample {
  label: string
  language: string
  code: string
}

interface RequestVariant {
  mediaType: string
  media: Record<string, unknown>
  name?: string
  example?: unknown
}

/** Returns the original bundled document; callers must not mutate it. */
export function getOperationSpec(reference: OperationReference): Record<string, unknown> {
  const documents: Record<string, Record<string, unknown>> = OPENAPI_DOCUMENTS_BY_FILE
  const document = documents[reference.specFile]
  if (!document) throw new Error(`Unknown OpenAPI document: ${reference.specFile}`)
  return document
}

/** Resolves one local JSON pointer while retaining OpenAPI 3.1 reference siblings. */
export function resolveReference(
  value: unknown,
  document: Record<string, unknown>
): Record<string, unknown> {
  const record = toRecord(value)
  if (typeof record.$ref !== 'string') return record
  if (!record.$ref.startsWith('#/'))
    throw new Error(`External OpenAPI reference is unsupported: ${record.$ref}`)
  let resolved: unknown = document
  for (const part of record.$ref.slice(2).split('/')) {
    resolved = toRecord(resolved)[part.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  if (!isRecordLike(resolved)) throw new Error(`Unresolved OpenAPI reference: ${record.$ref}`)
  const { $ref: _ref, ...siblings } = record
  return { ...resolved, ...siblings }
}

/** Expands references for reading, keeping recursive references explicit. */
export function resolveSchema(
  value: unknown,
  document: Record<string, unknown>,
  ancestors: Set<string> = new Set()
): unknown {
  if (Array.isArray(value)) return value.map((item) => resolveSchema(item, document, ancestors))
  if (!isRecordLike(value)) return value
  const reference = typeof value.$ref === 'string' ? value.$ref : undefined
  if (reference && ancestors.has(reference)) return value
  const next = reference ? new Set([...ancestors, reference]) : ancestors
  const record = reference ? resolveReference(value, document) : value
  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => [key, resolveSchema(child, document, next)])
  )
}

function exampleValue(
  value: unknown,
  document: Record<string, unknown>,
  ancestors = new Set<string>()
): unknown {
  const input = toRecord(value)
  if (typeof input.$ref === 'string' && ancestors.has(input.$ref)) return null
  const next = typeof input.$ref === 'string' ? new Set([...ancestors, input.$ref]) : ancestors
  const schema = resolveReference(value, document)
  if ('example' in schema) return schema.example
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0]
  if ('default' in schema) return schema.default
  if ('const' in schema) return schema.const
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0]
  const alternative = toArray(schema.oneOf ?? schema.anyOf)[0]
  if (alternative) return exampleValue(alternative, document, next)
  if (Array.isArray(schema.allOf))
    return Object.assign(
      {},
      ...schema.allOf.map((part) => toRecord(exampleValue(part, document, next)))
    )
  if (schema.type === 'object' || schema.properties) {
    const required = new Set(toArray(schema.required))
    const properties = Object.entries(toRecord(schema.properties))
    return Object.fromEntries(
      properties
        .filter(([key]) => required.has(key))
        .map(([key, child]) => [key, exampleValue(child, document, next)])
    )
  }
  if (schema.type === 'array') return [exampleValue(schema.items, document, next)]
  if (schema.type === 'integer' || schema.type === 'number')
    return typeof schema.minimum === 'number' ? schema.minimum : 1
  if (schema.type === 'boolean') return true
  if (schema.type === 'null') return null
  if (schema.format === 'date-time') return '2026-01-01T00:00:00Z'
  if (schema.format === 'date') return '2026-01-01'
  if (schema.format === 'email') return 'person@example.com'
  if (schema.format === 'uuid') return '00000000-0000-4000-8000-000000000001'
  if (schema.format === 'uri') return 'https://example.com'
  return 'string'
}

function firstExample(media: Record<string, unknown>, document: Record<string, unknown>): unknown {
  if ('example' in media) return media.example
  const examples = Object.values(toRecord(media.examples))
  if (examples.length) {
    const first = resolveReference(examples[0], document)
    if ('value' in first) return first.value
  }
  return exampleValue(media.schema, document)
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

/** Generates inert examples, including the owning operation's authentication and media type. */
function buildRequestSamples(
  reference: OperationReference,
  variant?: RequestVariant
): RequestSample[] {
  const document = getOperationSpec(reference)
  const operation = reference.operation
  const server = toRecord(toArray(operation.servers ?? document.servers)[0])
  const base = typeof server.url === 'string' ? server.url : 'https://www.sim.ai'
  let pathname = reference.path
  const query = new URLSearchParams()
  const headers: Record<string, string> = {}
  for (const raw of toArray(operation.parameters)) {
    const parameter = resolveReference(raw, document)
    if (typeof parameter.name !== 'string') continue
    const example = parameter.example ?? exampleValue(parameter.schema, document)
    if (parameter.in === 'path')
      pathname = pathname.replace(`{${parameter.name}}`, encodeURIComponent(String(example)))
    else if (parameter.required && parameter.in === 'query')
      query.set(parameter.name, String(example))
    else if (parameter.required && parameter.in === 'header')
      headers[parameter.name] = String(example)
  }
  const security = toArray(operation.security ?? document.security)
    .map(toRecord)
    .find((item) => Object.keys(item).length)
  const schemes = toRecord(toRecord(document.components).securitySchemes)
  for (const name of Object.keys(security ?? {})) {
    const scheme = resolveReference(schemes[name], document)
    if (scheme.type === 'apiKey' && typeof scheme.name === 'string') {
      if (scheme.in === 'header') headers[scheme.name] = 'YOUR_API_KEY'
      else if (scheme.in === 'query') query.set(scheme.name, 'YOUR_API_KEY')
      else if (scheme.in === 'cookie') headers.Cookie = `${scheme.name}=YOUR_API_KEY`
    } else if (scheme.type === 'oauth2' || scheme.scheme === 'bearer')
      headers.Authorization = 'Bearer YOUR_ACCESS_TOKEN'
    else if (scheme.scheme === 'basic') headers.Authorization = 'Basic BASE64_CREDENTIALS'
  }
  const requestBody = resolveReference(operation.requestBody, document)
  const mediaEntries = Object.entries(toRecord(requestBody.content))
  const entry = variant
    ? ([variant.mediaType, variant.media] as const)
    : (mediaEntries.find(([type]) => type === 'application/json') ?? mediaEntries[0])
  let body: string | undefined
  let multipart: Record<string, unknown> | undefined
  if (entry) {
    const [mediaType, media] = entry
    const example = variant?.example ?? firstExample(toRecord(media), document)
    if (mediaType === 'multipart/form-data')
      multipart = toRecord(resolveReference(toRecord(media).schema, document).properties)
    else {
      headers['Content-Type'] = mediaType
      body =
        mediaType === 'application/x-www-form-urlencoded'
          ? new URLSearchParams(
              Object.entries(toRecord(example)).map(([key, value]) => [key, String(value)])
            ).toString()
          : mediaType.includes('json')
            ? JSON.stringify(example, null, 2)
            : typeof example === 'string'
              ? example
              : JSON.stringify(example)
    }
  }
  const url = `${base.replace(/\/$/, '')}${pathname}${query.size ? `?${query}` : ''}`
  const curl = [
    `curl --request ${reference.method} ${quoteShell(url)}`,
    ...Object.entries(headers).map(
      ([key, value]) => `  --header ${quoteShell(`${key}: ${value}`)}`
    ),
  ]
  if (multipart) {
    const entries = Object.entries(multipart).map(([name, raw]) => ({
      name,
      schema: resolveReference(raw, document),
    }))
    const form = ['const form = new FormData();']
    const pythonFiles: string[] = []
    const pythonData: Record<string, string> = {}
    for (const { name, schema } of entries) {
      if (schema.format === 'binary' || schema.contentEncoding === 'binary') {
        curl.push(`  --form ${quoteShell(`${name}=@/path/to/document.pdf`)}`)
        form.push(`form.append(${JSON.stringify(name)}, fileInput.files[0]);`)
        pythonFiles.push(`        ${JSON.stringify(name)}: document`)
      } else {
        const value = String(exampleValue(schema, document))
        curl.push(`  --form ${quoteShell(`${name}=${value}`)}`)
        form.push(`form.append(${JSON.stringify(name)}, ${JSON.stringify(value)});`)
        pythonData[name] = value
      }
    }
    const javascript = `const fileInput = document.querySelector('input[type="file"]');\n${form.join('\n')}\nconst response = await fetch(${JSON.stringify(url)}, {\n  method: ${JSON.stringify(reference.method)},\n  headers: ${JSON.stringify(headers, null, 2)},\n  body: form,\n});\nconst result = await response.json();`
    const python = `import requests\n\nwith open("/path/to/document.pdf", "rb") as document:\n    response = requests.request(\n        ${JSON.stringify(reference.method)},\n        ${JSON.stringify(url)},\n        headers=${JSON.stringify(headers)},\n        files={\n${pythonFiles.join(',\n')}\n        },\n        data=${JSON.stringify(pythonData)},\n    )\nresponse.raise_for_status()\nresult = response.json()`
    return [
      { label: 'cURL', language: 'bash', code: curl.join(' \\\n') },
      { label: 'JavaScript', language: 'javascript', code: javascript },
      { label: 'Python', language: 'python', code: python },
    ]
  }
  if (body !== undefined) curl.push(`  --data ${quoteShell(body)}`)
  const options = { method: reference.method, headers, ...(body === undefined ? {} : { body }) }
  const js = `const response = await fetch(${JSON.stringify(url)}, ${JSON.stringify(options, null, 2)});\nconst result = await response.json();`
  const pyHeaders = JSON.stringify(headers, null, 2)
  const python = `import requests\n\nresponse = requests.request(\n    ${JSON.stringify(reference.method)},\n    ${JSON.stringify(url)},\n    headers=${pyHeaders},${body === undefined ? '' : `\n    data=${JSON.stringify(body)},`}\n)\nresponse.raise_for_status()\nresult = response.json()`
  return [
    { label: 'cURL', language: 'bash', code: curl.join(' \\\n') },
    { label: 'JavaScript', language: 'javascript', code: js },
    { label: 'Python', language: 'python', code: python },
  ]
}

/** Includes every declared request media type and named example without network execution. */
export function requestSamples(reference: OperationReference): RequestSample[] {
  const document = getOperationSpec(reference)
  const requestBody = resolveReference(reference.operation.requestBody, document)
  const variants: RequestVariant[] = []
  for (const [mediaType, raw] of Object.entries(toRecord(requestBody.content))) {
    const media = toRecord(raw)
    const examples = Object.entries(toRecord(media.examples))
    if (!examples.length) variants.push({ mediaType, media })
    else
      for (const [name, rawExample] of examples) {
        const example = resolveReference(rawExample, document)
        variants.push({
          mediaType,
          media,
          name: typeof example.summary === 'string' ? example.summary : name,
          example: example.value,
        })
      }
  }
  if (variants.length <= 1) return buildRequestSamples(reference, variants[0])
  return variants.flatMap((variant) =>
    buildRequestSamples(reference, variant).map((sample) => ({
      ...sample,
      label: `${sample.label} — ${variant.name ?? variant.mediaType}`,
    }))
  )
}

/** Keeps every response status, representation, and named example available to the shared picker. */
export function responseSamples(reference: OperationReference): RequestSample[] {
  const document = getOperationSpec(reference)
  return Object.entries(toRecord(reference.operation.responses)).flatMap(([status, raw]) => {
    const response = resolveReference(raw, document)
    const mediaEntries = Object.entries(toRecord(response.content))
    if (!mediaEntries.length) return [{ label: status, language: 'text', code: '' }]
    return mediaEntries.flatMap(([mediaType, rawMedia]) => {
      const media = toRecord(rawMedia)
      const language = mediaType.includes('json') ? 'json' : 'text'
      const suffix = mediaEntries.length > 1 ? ` ${mediaType}` : ''
      const render = (value: unknown) =>
        typeof value === 'string' && language !== 'json' ? value : JSON.stringify(value, null, 2)
      const examples = Object.entries(toRecord(media.examples))
      if (examples.length)
        return examples.map(([name, rawExample]) => {
          const example = resolveReference(rawExample, document)
          return {
            label: `${status}${suffix} — ${typeof example.summary === 'string' ? example.summary : name}`,
            language,
            code:
              'value' in example
                ? render(example.value)
                : typeof example.externalValue === 'string'
                  ? `Example: ${example.externalValue}`
                  : render(firstExample(media, document)),
          }
        })
      return [
        {
          label: `${status}${suffix}${'example' in media ? '' : ' (schema example)'}`,
          language,
          code: render(firstExample(media, document)),
        },
      ]
    })
  })
}

function operationMarkdown(reference: OperationReference, title: string, url: string): string {
  const document = getOperationSpec(reference)
  const operation = reference.operation
  const lines = [
    `# ${title} (${url})`,
    `\`${reference.method} ${reference.path}\``,
    typeof operation.description === 'string' ? operation.description : '',
  ]
  if (operation.deprecated) lines.push('> Deprecated operation.')
  const schemes = toRecord(toRecord(document.components).securitySchemes)
  lines.push(
    '## Authentication',
    '```json',
    JSON.stringify(
      {
        requirements: operation.security ?? document.security ?? [],
        schemes: resolveSchema(schemes, document),
      },
      null,
      2
    ),
    '```'
  )
  if (typeof operation['x-oauth-scope'] === 'string')
    lines.push(`Required OAuth scope: \`${operation['x-oauth-scope']}\`.`)
  lines.push('## Request examples')
  for (const sample of requestSamples(reference))
    lines.push(`### ${sample.label}`, `\`\`\`${sample.language}\n${sample.code}\n\`\`\``)
  if (toArray(operation.parameters).length)
    lines.push(
      '## Parameters',
      '```json',
      JSON.stringify(resolveSchema(operation.parameters, document), null, 2),
      '```'
    )
  if (operation.requestBody)
    lines.push(
      '## Request body',
      '```json',
      JSON.stringify(resolveSchema(operation.requestBody, document), null, 2),
      '```'
    )
  if (typeof operation['x-sim-docs-details'] === 'string')
    lines.push('## Behavior', operation['x-sim-docs-details'])
  lines.push('## Responses')
  for (const [status, response] of Object.entries(toRecord(operation.responses)))
    lines.push(
      `### ${status}`,
      '```json',
      JSON.stringify(resolveSchema(response, document), null, 2),
      '```'
    )
  if (operation.callbacks)
    lines.push(
      '## Callbacks',
      '```json',
      JSON.stringify(resolveSchema(operation.callbacks, document), null, 2),
      '```'
    )
  const referenced = new Set<string>()
  const definitions: Record<string, unknown> = {}
  const inspect = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(inspect)
      return
    }
    if (!isRecordLike(value)) return
    if (typeof value.$ref === 'string' && !referenced.has(value.$ref)) {
      referenced.add(value.$ref)
      const definition = resolveReference(value, document)
      definitions[value.$ref] = definition
      inspect(definition)
    }
    Object.values(value).forEach(inspect)
  }
  inspect(operation)
  if (referenced.size)
    lines.push(
      '## Referenced schemas',
      'The following definitions preserve recursive references and composition exactly.',
      '```json',
      JSON.stringify(definitions, null, 2),
      '```'
    )
  lines.push(
    `[Download OpenAPI specification](/openapi.json)`,
    `Source: \`${reference.specFile}\`, operation \`${reference.operationId}\`.`
  )
  return lines.filter(Boolean).join('\n\n')
}

/** Builds virtual pages directly from canonical product-generated specifications. */
export function buildOperationPages(): DocsPage[] {
  const pages: DocsPage[] = []
  for (const specFile of OPENAPI_SPEC_FILES) {
    const document: Record<string, unknown> = OPENAPI_DOCUMENTS_BY_FILE[specFile]
    for (const [path, rawPath] of Object.entries(toRecord(document.paths))) {
      const pathItem = resolveReference(rawPath, document)
      for (const method of HTTP_METHODS) {
        if (!isRecordLike(pathItem[method])) continue
        const operation: Record<string, unknown> = {
          ...pathItem[method],
          parameters: [...toArray(pathItem.parameters), ...toArray(pathItem[method].parameters)],
        }
        if (typeof operation.operationId !== 'string')
          throw new Error(`${specFile}: ${method} ${path} has no operationId`)
        const tags = toArray(operation.tags).filter((tag): tag is string => typeof tag === 'string')
        for (const tag of tags.length ? tags : ['unknown']) {
          const url = `/api-reference/${tag.replace(/\s+/g, '-').toLowerCase()}/${operation.operationId}`
          const reference: OperationReference = {
            specFile,
            path,
            method: method.toUpperCase(),
            operationId: operation.operationId,
            operation,
          }
          const title =
            typeof operation.summary === 'string' ? operation.summary : operation.operationId
          const markdown = operationMarkdown(reference, title, url)
          const headings = [{ id: 'authentication', title: 'Authentication', depth: 2 }]
          const parameters = toArray(operation.parameters).map((parameter) =>
            resolveReference(parameter, document)
          )
          for (const location of ['path', 'query', 'header', 'cookie']) {
            if (parameters.some((parameter) => parameter.in === location))
              headings.push({
                id: `${location}-parameters`,
                title: `${location[0].toUpperCase()}${location.slice(1)} parameters`,
                depth: 2,
              })
          }
          if (operation.requestBody)
            headings.push({ id: 'request-body', title: 'Request body', depth: 2 })
          if (operation['x-sim-docs-details'])
            headings.push({ id: 'behavior', title: 'Behavior', depth: 2 })
          headings.push({ id: 'responses', title: 'Responses', depth: 2 })
          for (const status of Object.keys(toRecord(operation.responses)))
            headings.push({ id: `response-${status}`, title: status, depth: 3 })
          if (operation.callbacks) headings.push({ id: 'callbacks', title: 'Callbacks', depth: 2 })
          pages.push({
            id: url,
            url,
            slugs: url.slice(1).split('/'),
            title,
            description:
              typeof operation['x-sim-docs-intro'] === 'string'
                ? operation['x-sim-docs-intro']
                : typeof operation.description === 'string'
                  ? operation.description
                  : '',
            section: 'api',
            sourcePath: specFile,
            headings,
            markdown,
            contentHash: '',
            operation: reference,
          })
        }
      }
    }
  }
  return pages
}
