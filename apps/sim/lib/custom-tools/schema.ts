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
 * check — which is how the two drifted apart in the first place.
 */
export function isStorableCustomToolSchema(schema: unknown): boolean {
  return customToolSchemaSchema.safeParse(schema).success
}

/** {@link isStorableCustomToolSchema} as a caller-fixable validation failure. */
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
