/**
 * Shared Zod introspection for the v2 contract sweeps.
 *
 * Two sweeps ask the same question — "does this schema reject a key it does not
 * declare?" — and each used to carry its own walker with the hole the other
 * filled: the pagination sweep unwrapped wrappers but returned `null` for a
 * union (which it then skipped), and the tables sweep expanded unions but not
 * wrappers. A schema that is both wrapped and union-shaped was reachable by
 * neither. One walker handles both so a strictness claim cannot be vacuous by
 * virtue of which sweep happens to look at it.
 */

/** Depth cap so a self-referential `lazy` schema cannot spin the walk. */
export const MAX_SCHEMA_DEPTH = 12

export interface SchemaLike {
  def?: Record<string, unknown>
  safeParse: (value: unknown) => { success: boolean; error?: { issues: readonly unknown[] } }
}

function schemaDef(schema: unknown): Record<string, unknown> | undefined {
  return (schema as { def?: Record<string, unknown> } | undefined)?.def
}

/**
 * Flattens a schema onto the object schemas that actually carry strictness.
 *
 * Wrappers (`.optional()`, `.default()`, pipes) are unwrapped, and a union
 * expands to its members, because a union is only as strict as its weakest
 * member: asserting against the union itself is satisfied by any one strict
 * member, so a sibling that stopped being strict would still sweep green.
 *
 * A schema the walk cannot resolve falls back to the schema itself, so callers
 * that only `safeParse` the result keep working; use `rejectsUnknownKeys` when
 * an unresolvable schema must be distinguishable from a non-strict one.
 *
 * Note that a Zod 4 `.refine()` is a check on the schema rather than a wrapper,
 * so a refined object still reports `def.type === 'object'` and needs no
 * unwrapping here.
 */
export function strictnessTargets(
  schema: SchemaLike,
  depth: number = MAX_SCHEMA_DEPTH
): SchemaLike[] {
  const resolved = resolveStrictnessTargets(schema, depth)
  return resolved ?? [schema]
}

function resolveStrictnessTargets(schema: unknown, depth: number): SchemaLike[] | null {
  if (!schema || depth <= 0) return null
  const def = schemaDef(schema)
  if (!def) return null

  switch (def.type) {
    case 'object':
      return [schema as SchemaLike]
    case 'union': {
      const options = def.options as unknown[] | undefined
      if (!options?.length) return null
      const targets: SchemaLike[] = []
      for (const option of options) {
        const resolved = resolveStrictnessTargets(option, depth - 1)
        if (!resolved) return null
        targets.push(...resolved)
      }
      return targets
    }
    case 'lazy': {
      const getter = def.getter
      if (typeof getter !== 'function') return null
      try {
        return resolveStrictnessTargets(getter(), depth - 1)
      } catch {
        return null
      }
    }
    default: {
      const inner = def.innerType ?? def.in ?? def.schema
      return inner ? resolveStrictnessTargets(inner, depth - 1) : null
    }
  }
}

/** Whether an object schema declares `catchall(never)`, i.e. is `.strict()`. */
function isStrictObject(schema: SchemaLike): boolean {
  const def = schemaDef(schema)
  if (def?.type !== 'object') return false
  return (def.catchall as { def?: { type?: string } } | undefined)?.def?.type === 'never'
}

/**
 * Whether a schema rejects keys it does not declare, i.e. is `.strict()`.
 *
 * This is what separates "this list does not page" from "this list quietly
 * throws your `limit` away". Zod strips unknown keys by default, so a full-set
 * list that is not strict answers `?limit=1` with 200 and the entire set — the
 * caller believes it bounded the response and it did not.
 *
 * Returns `null` when the walk cannot reach an object schema, so an
 * un-introspectable schema fails loudly rather than passing as strict. A union
 * is strict only when **every** member is.
 */
export function rejectsUnknownKeys(
  schema: unknown,
  depth: number = MAX_SCHEMA_DEPTH
): boolean | null {
  const targets = resolveStrictnessTargets(schema, depth)
  if (!targets?.length) return null
  return targets.every(isStrictObject)
}

/**
 * Zod reports a union's member failures nested under the union issue, so a
 * union-bodied contract needs the whole tree walked before "did any member
 * reject the unknown key" can be answered.
 */
export function issueCodes(issues: readonly unknown[]): string[] {
  return issues.flatMap((issue) => {
    const entry = issue as { code?: string; errors?: unknown }
    return [
      ...(entry.code ? [entry.code] : []),
      ...(Array.isArray(entry.errors)
        ? entry.errors.flatMap((nested) => issueCodes(nested as readonly unknown[]))
        : []),
    ]
  })
}
