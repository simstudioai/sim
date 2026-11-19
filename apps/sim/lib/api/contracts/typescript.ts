import { isRecordLike, toRecord } from '@sim/utils/object'
import { z } from 'zod'

/**
 * TypeScript types for the JSON Schema `z.toJSONSchema` produces from the route
 * contracts. The Sim CLI generator and the MCP server's `describe_operation`
 * both render contract types through this one emitter, so the terminal and an
 * agent read the same shape for the same operation.
 *
 * Imports no `@/` paths: the root CLI generator imports it by relative path.
 */

type JsonSchema = Record<string, unknown>

const ANNOTATION_KEYS: ReadonlySet<string> = new Set([
  '$schema',
  'description',
  'title',
  'default',
  'examples',
])

function schemaList(value: unknown): JsonSchema[] | undefined {
  return Array.isArray(value) ? value.filter(isRecordLike) : undefined
}

/**
 * Hand-rolled rather than pulled from `json-schema-to-typescript`: the input is
 * a known, narrow subset (no `patternProperties`, no draft-04 quirks), and the
 * output is read by humans and models, so controlling the formatting is worth
 * more than covering spec corners that never appear. An unhandled construct
 * throws rather than degrading to `any`: silence is how a generated client
 * drifts from its server.
 *
 * `refs` maps a `$defs` key to the alias hoisted for it. Zod factors a schema
 * out into `$defs` when it is recursive, which the table filter grammar is.
 */
function toTypeScript(schema: JsonSchema, indent: number, refs?: Map<string, string>): string {
  if (typeof schema.$ref === 'string') {
    const name = refs?.get(schema.$ref.replace('#/$defs/', ''))
    if (!name) throw new Error(`Unresolved $ref: ${schema.$ref}`)
    return name
  }

  const pad = '  '.repeat(indent + 1)
  const closePad = '  '.repeat(indent)

  if (schema.const !== undefined) return JSON.stringify(schema.const)
  if (Array.isArray(schema.enum)) return schema.enum.map((v) => JSON.stringify(v)).join(' | ')

  const variants = schemaList(schema.anyOf) ?? schemaList(schema.oneOf)
  if (variants) return variants.map((v) => toTypeScript(v, indent, refs)).join(' | ')

  const parts = schemaList(schema.allOf)
  if (parts) {
    return parts
      .map((part) => {
        const type = toTypeScript(part, indent, refs)
        return schemaList(part.anyOf) || schemaList(part.oneOf) || Array.isArray(part.enum)
          ? `(${type})`
          : type
      })
      .join(' & ')
  }

  switch (schema.type) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    case 'array': {
      const tuple = schemaList(schema.prefixItems)
      const rest = isRecordLike(schema.items) ? toTypeScript(schema.items, indent, refs) : null
      if (tuple) {
        const elements = tuple.map((item) => toTypeScript(item, indent, refs))
        if (rest) elements.push(`...Array<${rest}>`)
        return `[${elements.join(', ')}]`
      }
      return rest ? `Array<${rest}>` : 'unknown[]'
    }
    case 'object': {
      const properties = toRecord(schema.properties)
      const required = Array.isArray(schema.required) ? schema.required : []
      const keys = Object.keys(properties)

      if (keys.length === 0) {
        if (schema.additionalProperties === false) return 'Record<string, never>'
        const value = isRecordLike(schema.additionalProperties)
          ? toTypeScript(schema.additionalProperties, indent, refs)
          : 'unknown'
        return `Record<string, ${value}>`
      }

      const types: string[] = []
      const lines = keys.map((key) => {
        const property = properties[key]
        const optional = required.includes(key) ? '' : '?'
        const safeKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key)
        const type = isRecordLike(property) ? toTypeScript(property, indent + 1, refs) : 'unknown'
        types.push(optional ? `${type} | undefined` : type)
        return `${pad}${safeKey}${optional}: ${type}`
      })
      // Extra keys are allowed; an index signature must also cover the named properties' types.
      if (isRecordLike(schema.additionalProperties)) {
        const extra = toTypeScript(schema.additionalProperties, indent + 1, refs)
        const value = extra === 'unknown' ? extra : [...new Set([extra, ...types])].join(' | ')
        lines.push(`${pad}[key: string]: ${value}`)
      }
      return `{\n${lines.join('\n')}\n${closePad}}`
    }
  }

  // `z.unknown()` renders as a schema with no constraints; `.describe()` adds
  // annotation keys without narrowing the type.
  if (Object.keys(schema).every((key) => ANNOTATION_KEYS.has(key))) return 'unknown'

  throw new Error(`Unhandled JSON Schema construct: ${JSON.stringify(schema).slice(0, 200)}`)
}

/** `listTables` → `ListTables`: how generated type aliases are named after an operation or slot. */
export function pascal(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** A type plus the aliases that must be declared before it. */
interface GeneratedType {
  type: string
  declarations: string[]
}

/**
 * Renders JSON Schema as a TypeScript type. A recursive schema cannot be
 * written inline, so its `$defs` become aliases named `${name}Ref<n>`, after
 * the owning type so two operations' aliases cannot collide.
 */
export function jsonSchemaToTypeScript(schema: JsonSchema, name: string): GeneratedType {
  const { $defs, ...root } = schema
  if (!isRecordLike($defs)) return { type: toTypeScript(root, 0), declarations: [] }

  const refs = new Map(Object.keys($defs).map((key, index) => [key, `${name}Ref${index}`]))
  const declarations = Object.entries($defs).map(
    ([key, def]) =>
      `type ${refs.get(key)} = ${isRecordLike(def) ? toTypeScript(def, 0, refs) : 'unknown'}\n`
  )
  return { type: toTypeScript(root, 0, refs), declarations }
}

/**
 * A contract schema as JSON Schema, the way it crosses the wire: a date is the
 * ISO string JSON carries, rather than the unconstrained schema Zod falls back
 * to for a type JSON Schema cannot represent.
 */
export function contractJsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  return z.toJSONSchema(schema, {
    io,
    unrepresentable: 'any',
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema._zod.def.type === 'date') {
        jsonSchema.type = 'string'
        jsonSchema.format = 'date-time'
      }
    },
  }) as JsonSchema
}

/** Renders a contract schema as a TypeScript type; see {@link jsonSchemaToTypeScript}. */
export function schemaToTypeScript(
  schema: z.ZodType,
  io: 'input' | 'output',
  name: string
): GeneratedType {
  return jsonSchemaToTypeScript(contractJsonSchema(schema, io), name)
}

/**
 * Whether a request part must be sent: its object requires a field, or every
 * branch of its union does.
 */
export function isJsonSchemaRequired(schema: JsonSchema, defs = toRecord(schema.$defs)): boolean {
  if (typeof schema.$ref === 'string') {
    const target = defs[schema.$ref.replace('#/$defs/', '')]
    return isRecordLike(target) && isJsonSchemaRequired(target, defs)
  }
  if (Array.isArray(schema.required) && schema.required.length > 0) return true
  const variants = schemaList(schema.anyOf) ?? schemaList(schema.oneOf)
  if (variants) return variants.every((variant) => isJsonSchemaRequired(variant, defs))
  const parts = schemaList(schema.allOf)
  return parts ? parts.some((part) => isJsonSchemaRequired(part, defs)) : false
}
