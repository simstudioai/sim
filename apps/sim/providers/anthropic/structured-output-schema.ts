import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema'

type JsonSchemaNode = Record<string, unknown>

/**
 * Keywords Anthropic's structured-output grammar enforces but the SDK's
 * `transformJSONSchema` does not recognise. The transform pops every keyword it
 * knows and stringifies whatever is left into the node's `description`, so an
 * `enum` or `const` left in place silently degrades from a grammar constraint
 * into prose the model may ignore.
 */
const PRESERVED_KEYWORDS = ['enum', 'const'] as const

/**
 * The API grammar-checks only a narrow slice of `enum` and `const` and rejects
 * the entire request for the rest, so a keyword outside that slice is left in
 * place for the transform to demote into `description` — weakly enforced, but
 * exactly today's behaviour. Lifting one would turn a working Agent block into a
 * hard 400 on every run, which is strictly worse than the bug being fixed.
 *
 * Boundary confirmed against the live API: object or array members fail with
 * "Schema type 'enum - complex' is not supported"; a member disagreeing with the
 * node's declared `type` fails with "Enum value ... does not match declared
 * type"; `[]` fails with "Enum must be non-empty". `const` accepts any primitive
 * including `null` and is not checked against `type`, but rejects objects and
 * arrays as "Schema type 'const - complex' is not supported".
 */
function isPrimitive(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

function matchesDeclaredType(value: unknown, type: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
    case 'integer':
      return typeof value === 'number'
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    default:
      return false
  }
}

/**
 * True when every member is a primitive matching the node's declared scalar
 * type. An absent, composite, or non-scalar `type` yields false, so the keyword
 * stays behind rather than being lifted onto a node the API would reject.
 */
function isLiftableEnum(value: unknown, type: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((member) => isPrimitive(member) && matchesDeclaredType(member, type))
  )
}

/** A constraint lifted out of the source schema, addressed by its post-transform path. */
interface PreservedConstraint {
  /** Path into the transformed schema, expressed with the transform's own key names. */
  path: (string | number)[]
  keywords: JsonSchemaNode
}

function isSchemaNode(value: unknown): value is JsonSchemaNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Removes the preserved keywords from `node` and records them against the path
 * the transform will place that node at.
 *
 * The traversal mirrors `transformJSONSchema` exactly: `$ref` short-circuits the
 * whole node, `oneOf` is rewritten to `anyOf`, `allOf` is only visited when
 * neither `anyOf` nor `oneOf` is present, and `properties`/`items` are visited
 * on the declared `type`. Any divergence would re-attach a constraint to a node
 * the transform did not emit, which the resolve step then drops.
 */
function extractPreservedKeywords(
  node: JsonSchemaNode,
  path: (string | number)[],
  out: PreservedConstraint[]
): void {
  if (node.$ref !== undefined) return

  if (isSchemaNode(node.$defs)) {
    for (const [name, defSchema] of Object.entries(node.$defs)) {
      if (isSchemaNode(defSchema)) {
        extractPreservedKeywords(defSchema, [...path, '$defs', name], out)
      }
    }
  }

  const branches = Array.isArray(node.anyOf)
    ? { key: 'anyOf', variants: node.anyOf }
    : Array.isArray(node.oneOf)
      ? { key: 'anyOf', variants: node.oneOf }
      : Array.isArray(node.allOf)
        ? { key: 'allOf', variants: node.allOf }
        : null

  if (branches) {
    branches.variants.forEach((variant, index) => {
      if (isSchemaNode(variant)) {
        extractPreservedKeywords(variant, [...path, branches.key, index], out)
      }
    })
  }

  if (node.type === 'object') {
    if (isSchemaNode(node.properties)) {
      for (const [key, propSchema] of Object.entries(node.properties)) {
        if (isSchemaNode(propSchema)) {
          extractPreservedKeywords(propSchema, [...path, 'properties', key], out)
        }
      }
    }
  } else if (node.type === 'array' && isSchemaNode(node.items)) {
    extractPreservedKeywords(node.items, [...path, 'items'], out)
  }

  const keywords: JsonSchemaNode = {}
  for (const keyword of PRESERVED_KEYWORDS) {
    if (!(keyword in node)) continue
    const value = node[keyword]
    const liftable = keyword === 'enum' ? isLiftableEnum(value, node.type) : isPrimitive(value)
    if (!liftable) continue
    keywords[keyword] = value
    delete node[keyword]
  }

  if (Object.keys(keywords).length > 0) out.push({ path, keywords })
}

function resolvePath(root: JsonSchemaNode, path: (string | number)[]): JsonSchemaNode | null {
  let current: unknown = root
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return null
      current = current[segment]
      continue
    }
    if (!isSchemaNode(current)) return null
    current = current[segment]
  }
  return isSchemaNode(current) ? current : null
}

/**
 * Sanitises a response-format schema for Anthropic's `output_config.format`.
 *
 * The SDK transform is load-bearing — the API rejects unknown string formats,
 * numeric bounds, `minItems` above one, and a missing `additionalProperties` —
 * so the schema still goes through it. The `enum` and `const` shapes the API
 * actually grammar-checks are lifted out first and re-attached afterwards, which
 * keeps them real constraints instead of description prose without weakening any
 * of the transform's sanitising. Every other shape is left for the transform to
 * demote, so no schema that works today starts failing.
 */
export function buildAnthropicStructuredOutputSchema(schema: unknown): JsonSchemaNode {
  if (!isSchemaNode(schema)) return transformJSONSchema(schema as JsonSchemaNode)

  const working = structuredClone(schema)
  const preserved: PreservedConstraint[] = []
  extractPreservedKeywords(working, [], preserved)

  const transformed = transformJSONSchema(working) as JsonSchemaNode

  for (const { path, keywords } of preserved) {
    const target = resolvePath(transformed, path)
    if (target) Object.assign(target, keywords)
  }

  return transformed
}
