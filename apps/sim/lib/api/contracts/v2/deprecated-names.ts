import { z } from 'zod'

/**
 * Deprecated names on the public v2 surface. A field, query parameter or value renamed after it
 * shipped keeps its old name as an alias, so a client written against the earlier name keeps
 * working: a request alias is folded into the current name at parse time (routes and use cases
 * only ever see the current one), and a renamed response field is sent under both names.
 */

/** A request field kept under its old name: same meaning as `current`, marked deprecated. */
export function deprecatedRequestName<S extends z.ZodType>(current: string, schema: S): S {
  return schema.meta({
    deprecated: true,
    description: `Deprecated name of \`${current}\`, accepted with the same meaning. Send \`${current}\`; a request that sends both with different values is refused.`,
  })
}

/** A response field still sent under its old name: always equal to `current`, marked deprecated. */
function deprecatedResponseName<S extends z.ZodType>(current: string, schema: S): S {
  return schema.meta({
    deprecated: true,
    description: `Deprecated name of \`${current}\`, always sent with the same value. Read \`${current}\`.`,
  })
}

/**
 * Folds the deprecated `old` field of an object into `current` and drops it from the parsed
 * value. Sending only `old` acts exactly as sending `current`; sending both is refused unless
 * they agree.
 */
export function foldDeprecatedName<
  S extends z.ZodType<Record<string, unknown>>,
  Old extends keyof z.output<S> & string,
  Current extends keyof z.output<S> & string,
>(schema: S, old: Old, current: Current) {
  return schema.transform((value, ctx): Omit<z.output<S>, Old> => {
    const { [old]: legacy, ...rest } = value
    if (legacy === undefined) return rest
    const given: unknown = value[current]
    if (given !== undefined && given !== legacy) {
      ctx.addIssue({
        code: 'custom',
        path: [old],
        message: `${old} is the deprecated name of ${current}; send only ${current}`,
      })
      return z.NEVER
    }
    return { ...rest, [current]: legacy }
  })
}

/** Both names of a dry-run flag in a response: `dry`, and the deprecated `dryRun`. */
export function presentDry(dry: boolean): { dry: boolean; dryRun: boolean } {
  return { dry, dryRun: dry }
}

/** The deprecated `dryRun` response field beside `dry`. */
export const deprecatedDryRunResponseField = deprecatedResponseName('dry', z.boolean())
