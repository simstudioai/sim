import { isRecordLike, omit } from '@sim/utils/object'

const DEFINITION_KEYWORDS = ['$defs', 'definitions'] as const

function decodePointerSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~')
}

function referencesRef(value: unknown, ref: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => referencesRef(entry, ref))
  if (!isRecordLike(value)) return false
  return Object.entries(value).some(
    ([key, entry]) => (key === '$ref' && entry === ref) || referencesRef(entry, ref)
  )
}

/**
 * Inlines a JSON Schema whose root is nothing but a `$ref` into its own
 * definitions, the shape `z.toJSONSchema` (zod 4.6+) emits for a root schema
 * carrying `.meta({ id })`. The referenced definition becomes the root body and
 * stays in `$defs`/`definitions` only while something still references it, so
 * a recursive schema keeps resolving. A schema whose root is not such a local
 * reference is returned unchanged.
 */
export function inlineRootRef(schema: Record<string, unknown>): Record<string, unknown> {
  const ref = schema.$ref
  if (typeof ref !== 'string') return schema
  for (const keyword of DEFINITION_KEYWORDS) {
    const prefix = `#/${keyword}/`
    if (!ref.startsWith(prefix)) continue
    const definitions = schema[keyword]
    if (!isRecordLike(definitions)) return schema
    const name = decodePointerSegment(ref.slice(prefix.length))
    const root = definitions[name]
    if (!isRecordLike(root)) return schema

    const { $ref: _ref, $schema, [keyword]: _definitions, ...siblings } = schema
    const body = { ...root, ...siblings }
    const others = omit(definitions, [name])
    const remaining = referencesRef([body, others], ref) ? definitions : others
    return {
      ...($schema === undefined ? {} : { $schema }),
      ...body,
      ...(Object.keys(remaining).length > 0 ? { [keyword]: remaining } : {}),
    }
  }
  return schema
}
