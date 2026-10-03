import { customToolSchemaSchema } from '@/lib/api/contracts/tools/custom'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/**
 * Storage invariant for the `custom_tools.schema` column.
 *
 * The column is published verbatim by the v2 custom tool surface, whose
 * response declaration extends {@link customToolSchemaSchema} and is parsed on
 * the way out. A stored schema that does not satisfy it cannot be serialized
 * back at all: one such row fails the whole `GET /api/v2/custom-tools` page,
 * and an update commits and audits before its own response parse throws, so the
 * caller is told a write failed after it succeeded.
 *
 * Every writer is therefore held to the read shape here, against the same
 * schema the response is built from, rather than each write path restating the
 * check — which is how the two drifted apart in the first place. Raised as a
 * caller-fixable validation failure.
 */
export function assertStorableCustomToolSchema(schema: unknown): void {
  const parsed = customToolSchemaSchema.safeParse(schema)
  if (parsed.success) return
  const issue = parsed.error.issues[0]
  const path = issue?.path.join('.')
  throw new OrchestrationError(
    'validation',
    `Invalid custom tool schema${path ? ` at ${path}` : ''}: ${issue?.message ?? 'does not match the published function declaration'}`
  )
}

/**
 * The charset OpenAI, Anthropic, and MCP all accept for a tool's function name:
 * letters, digits, underscores and hyphens, 1-64 characters.
 */
const FUNCTION_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/

/**
 * Write-time invariant for a caller-supplied custom tool declaration, layered on
 * top of {@link assertStorableCustomToolSchema}'s storage/serialization shape.
 *
 * `customToolSchemaSchema` only requires a non-empty `function.name` and a
 * string `parameters.type`, so `"has spaces!"` and `"banana"` were accepted and
 * stored verbatim — a name no provider will accept in a tool declaration, and a
 * JSON Schema type that is not an object. That schema is also the shape the v2
 * surface parses on the way *out*, so it cannot be tightened without failing
 * reads of rows the old validation already admitted; the stricter rule belongs
 * here, on the write, and is applied only to a declaration the caller actually
 * supplied so a legacy row stays editable.
 *
 * Rejects rather than normalizes, unlike the workflow MCP tool path's
 * `sanitizeToolName`. That name is *derived* from a workflow's human-authored
 * title, which was never an identifier, so coercing it is the only way to get
 * one. A custom tool's `function.name` is written by the caller as an
 * identifier and is what the model calls, so silently rewriting it would
 * desync the stored tool from the caller's own references to it.
 */
export function assertValidCustomToolDeclaration(schema: unknown): void {
  assertStorableCustomToolSchema(schema)

  const declaration = (schema as { function: { name: string; parameters: { type: string } } })
    .function

  if (!FUNCTION_NAME_PATTERN.test(declaration.name)) {
    throw new OrchestrationError(
      'validation',
      `Invalid custom tool schema at function.name: "${declaration.name}" must be 1-64 characters of letters, digits, underscores, or hyphens`
    )
  }

  if (declaration.parameters.type !== 'object') {
    throw new OrchestrationError(
      'validation',
      `Invalid custom tool schema at function.parameters.type: expected "object", received "${declaration.parameters.type}"`
    )
  }
}

/**
 * {@link assertValidCustomToolDeclaration} as a predicate, for the import path
 * that skips an unusable declaration per tool rather than failing the batch.
 */
export function isValidCustomToolDeclaration(schema: unknown): boolean {
  try {
    assertValidCustomToolDeclaration(schema)
    return true
  } catch {
    return false
  }
}
