export interface ReferenceSchema {
  $ref?: string
  type?: string | string[]
  properties?: Record<string, ReferenceSchema>
  items?: ReferenceSchema
  anyOf?: ReferenceSchema[]
  oneOf?: ReferenceSchema[]
  allOf?: ReferenceSchema[]
  nullable?: boolean
  enum?: unknown[]
  const?: unknown
  required?: string[]
}

export interface ReferenceDocument {
  paths: Record<
    string,
    Record<
      string,
      {
        responses?: Record<string, { content?: Record<string, { schema?: ReferenceSchema }> }>
        requestBody?: { content?: Record<string, { schema?: ReferenceSchema }> }
      }
    >
  >
  components?: { schemas?: Record<string, ReferenceSchema> }
}

function resolve(doc: ReferenceDocument, schema: ReferenceSchema): ReferenceSchema {
  const visited = new Set<string>()
  let current = schema
  while (current.$ref) {
    const reference = current.$ref
    if (visited.has(reference)) throw new Error(`Circular schema alias: ${reference}`)
    visited.add(reference)
    const name = reference.split('/').pop()!
    const target = doc.components?.schemas?.[name]
    if (!target) throw new Error(`Unresolved reference: ${reference}`)
    current = target
  }
  return current
}

/** Bounded expansion preserves unions as alternatives and always groups array elements. */
function label(
  doc: ReferenceDocument,
  schema: ReferenceSchema,
  depth: number,
  brief: boolean,
  ancestors: ReadonlySet<ReferenceSchema> = new Set()
): string {
  const value = resolve(doc, schema)
  if (ancestors.has(value)) return schema.$ref?.split('/').pop() ?? 'recursive'
  const visited = new Set([...ancestors, value])
  const render = (item: ReferenceSchema, childDepth = depth): string =>
    label(doc, item, childDepth, brief, visited)
  let text: string
  if (value.const !== undefined) text = JSON.stringify(value.const)
  else if (value.enum) {
    text =
      brief && value.enum.length > 2
        ? `${JSON.stringify(value.enum[0])}|…(${value.enum.length})`
        : value.enum.map((item) => JSON.stringify(item)).join('|')
  } else if (value.anyOf || value.oneOf)
    text = (value.anyOf ?? value.oneOf)!.map((item) => render(item)).join('|')
  else if (value.allOf) text = value.allOf.map((item) => `(${render(item)})`).join('&')
  else if (Array.isArray(value.type))
    text = value.type.map((type) => render({ ...value, type, nullable: false })).join('|')
  else if (value.type === 'array') {
    const item = value.items ? render(value.items) : 'unknown'
    const element = value.items ? resolve(doc, value.items) : undefined
    const grouped =
      element &&
      (element.anyOf ||
        element.oneOf ||
        element.allOf ||
        element.nullable ||
        Array.isArray(element.type) ||
        (element.enum && element.enum.length > 1))
    text = `${grouped ? `(${item})` : item}[]`
  } else if (value.type === 'object' || value.properties) {
    const keys = Object.keys(value.properties ?? {})
    const required = new Set(value.required ?? [])
    text =
      keys.length === 0
        ? 'object'
        : `{${keys
            .map((key) =>
              depth > 0
                ? `${key}${required.has(key) ? '' : '?'}:${render(value.properties![key]!, depth - 1)}`
                : key
            )
            .join(',')}}`
  } else text = value.type ?? 'unknown'
  return value.nullable ? `${text}|null` : text
}

/** `result.data ?? result` retains the envelope when data is null (files share get). */
function coalescedData(
  doc: ReferenceDocument,
  envelope: ReferenceSchema,
  schema: ReferenceSchema
): ReferenceSchema {
  const value = resolve(doc, schema)
  const variants = value.anyOf ?? value.oneOf
  if (variants) return { anyOf: variants.map((item) => coalescedData(doc, envelope, item)) }
  if (value.type === 'null')
    return { ...envelope, properties: { ...envelope.properties, data: value } }
  return value
}

/** The ordinary CLI unwraps one data envelope, including each alternate response form. */
function payload(doc: ReferenceDocument, schema: ReferenceSchema): ReferenceSchema {
  const value = resolve(doc, schema)
  if (value.anyOf) return { anyOf: value.anyOf.map((item) => payload(doc, item)) }
  if (value.oneOf) return { oneOf: value.oneOf.map((item) => payload(doc, item)) }
  return value.properties?.data ? coalescedData(doc, value, value.properties.data) : value
}

/** Scalar flags already describe themselves; retain the JSON-valued fields within every alternative. */
function request(
  doc: ReferenceDocument,
  schema: ReferenceSchema,
  fields: ReadonlyMap<string, string>
): ReferenceSchema {
  const value = resolve(doc, schema)
  if (value.anyOf) return { anyOf: value.anyOf.map((item) => request(doc, item, fields)) }
  if (value.oneOf) return { oneOf: value.oneOf.map((item) => request(doc, item, fields)) }
  if (value.allOf) return { allOf: value.allOf.map((item) => request(doc, item, fields)) }
  if (!value.properties) return value
  const entries = Object.entries(value.properties).filter(([name]) => fields.has(name))
  const properties = Object.fromEntries(
    entries.map(([name, schema]) => [fields.get(name)!, schema])
  )
  const required = (value.required ?? [])
    .filter((key) => fields.has(key))
    .map((key) => fields.get(key)!)
  return { type: 'object', properties, required }
}

export interface CommandReference {
  /** JSON stdout, after the CLI's one-envelope projection. */
  shape?: string
  /** JSON-valued request fields; unions retain mutually alternative bodies. */
  body?: string
}

/** Extract every documented successful JSON response, including 201/202 and alternate bodies. */
export function commandReference(
  documents: readonly ReferenceDocument[],
  operation: { path: string; method: string },
  jsonFields: ReadonlyMap<string, string>
): CommandReference {
  const path = operation.path.replace(/\[([^\]]+)\]/g, '{$1}')
  for (const doc of documents) {
    const entry = doc.paths[path]?.[operation.method.toLowerCase()]
    if (!entry) continue
    const shapes = Object.entries(entry.responses ?? {})
      .filter(([status]) => /^2\d\d$/.test(status))
      .flatMap(([, response]) => {
        const schema = response.content?.['application/json']?.schema
        return schema ? [label(doc, payload(doc, schema), 1, true)] : []
      })
    const schema = entry.requestBody?.content?.['application/json']?.schema
    return {
      ...(shapes.length ? { shape: [...new Set(shapes)].join('|') } : {}),
      ...(schema && jsonFields.size
        ? { body: label(doc, request(doc, schema, jsonFields), 3, false) }
        : {}),
    }
  }
  return {}
}
