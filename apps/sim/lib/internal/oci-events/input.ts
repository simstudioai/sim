import { z } from 'zod'

const id = z.string().trim().min(1).max(1024)
const strings = z.record(z.string(), z.string())
const connection = {
  oauthCredential: id,
  region: z.string().trim().min(1).max(128).optional(),
  opcRequestId: z.string().min(1).max(1024).optional(),
}

/** Bound resolved JSON before recursive schema parsing allocates a validated copy. */
function withinJsonBudget(value: unknown): boolean {
  let nodes = 0
  let textBytes = 0
  const ancestors = new WeakSet<object>()
  function visit(item: unknown, depth: number): boolean {
    if (++nodes > 10_000 || depth > 32) return false
    if (typeof item === 'string') {
      if (item.length > 1024 * 1024) return false
      textBytes += Buffer.byteLength(item, 'utf8')
      return textBytes <= 1024 * 1024
    }
    if (item === null || typeof item === 'boolean') return true
    if (typeof item === 'number') return Number.isFinite(item)
    if (typeof item !== 'object' || ancestors.has(item)) return false
    ancestors.add(item)
    if (Array.isArray(item)) {
      if (item.length > 10_000) return false
      for (const child of item) {
        if (!visit(child, depth + 1)) return false
      }
    } else {
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue
        if (!visit(key, depth + 1) || !visit(Reflect.get(item, key), depth + 1)) return false
      }
    }
    ancestors.delete(item)
    return true
  }
  return visit(value, 0)
}

/** Accept JSON editor text and resolved workflow objects without accepting request passthrough. */
function json<T extends z.ZodType>(schema: T) {
  return z.preprocess((value, ctx) => {
    if (typeof value === 'string') {
      if (value.length > 1024 * 1024 || Buffer.byteLength(value, 'utf8') > 1024 * 1024) {
        ctx.addIssue({ code: 'custom', message: 'JSON input exceeds the 1 MiB Sim input limit' })
        return z.NEVER
      }
      try {
        value = JSON.parse(value)
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Provide valid JSON' })
        return z.NEVER
      }
    }
    if (!withinJsonBudget(value)) {
      ctx.addIssue({
        code: 'custom',
        message: 'JSON input exceeds Sim limits: 1 MiB of text, 10000 values or 32 nesting levels',
      })
      return z.NEVER
    }
    return value
  }, schema)
}

const matchValue = z.union([z.string(), z.array(z.string()).min(1)])
const condition = json(
  z
    .object({
      eventType: matchValue.optional(),
      data: z.record(z.string(), z.json()).optional(),
    })
    .catchall(z.json())
)
const action = {
  isEnabled: z.boolean(),
  description: z.string().max(1024).optional(),
}
const actions = json(
  z
    .array(
      z.discriminatedUnion('actionType', [
        z.object({ ...action, actionType: z.literal('ONS'), topicId: id }).strict(),
        z.object({ ...action, actionType: z.literal('OSS'), streamId: id }).strict(),
        z.object({ ...action, actionType: z.literal('FAAS'), functionId: id }).strict(),
      ])
    )
    .min(1)
    .max(10)
)
const ruleFields = {
  displayName: z.string().min(1).max(255),
  description: z.string().max(1024).optional(),
  isEnabled: z.boolean(),
  condition,
  actions,
  freeformTags: json(strings).optional(),
  definedTags: json(z.record(z.string(), strings)).optional(),
}
const ifMatch = { ifMatch: z.string().min(1).max(1024).optional() }
const retryToken = { opcRetryToken: z.string().min(1).max(64).optional() }

export const ociEventsInputSchemas = {
  list_rules: z.object({
    ...connection,
    compartmentId: id,
    limit: z.number().int().min(1).max(50).default(10),
    page: z.string().min(1).max(1024).optional(),
    displayName: z.string().min(1).max(1024).optional(),
    lifecycleState: z
      .enum(['CREATING', 'ACTIVE', 'INACTIVE', 'UPDATING', 'DELETING', 'DELETED', 'FAILED'])
      .optional(),
    sortBy: z.enum(['TIME_CREATED', 'ID', 'DISPLAY_NAME']).optional(),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
  }),
  get_rule: z.object({ ...connection, ruleId: id }),
  create_rule: z.object({ ...connection, ...ruleFields, compartmentId: id, ...retryToken }),
  update_rule: z
    .object({
      ...connection,
      ...z.object(ruleFields).partial().shape,
      ruleId: id,
      ...ifMatch,
    })
    .refine(
      (value) => Object.keys(ruleFields).some((key) => Reflect.get(value, key) !== undefined),
      'Provide at least one rule field to update'
    ),
  delete_rule: z.object({ ...connection, ruleId: id, ...ifMatch }),
  change_rule_compartment: z.object({
    ...connection,
    ruleId: id,
    destinationCompartmentId: z.string().trim().min(1).max(255),
    ...ifMatch,
    ...retryToken,
  }),
} as const

export type OciEventsOperation = keyof typeof ociEventsInputSchemas
export type OciEventsInput = z.output<(typeof ociEventsInputSchemas)[OciEventsOperation]>
export type OciEventsParams<T extends OciEventsOperation> = z.input<
  (typeof ociEventsInputSchemas)[T]
>
