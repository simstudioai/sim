import { isPlainRecord } from '@sim/utils/object'
import { z } from 'zod'

const toolNameSchema = z
  .string()
  .min(1, 'MCP tool ID is required')
  .max(256, 'MCP tool ID must be at most 256 characters')
  .refine((name): boolean => name === name.trim() && !isMcpRuntimeReference(name), {
    message: 'MCP tool IDs must be literal names without surrounding whitespace',
  })
  .describe('Exact MCP tool name on the resolved connection, without a Sim server prefix.')

/** Matches literal MCP tool names after the connection has been resolved and authorized. */
export const mcpOperationPolicySchema = z
  .discriminatedUnion('mode', [
    z
      .object({
        mode: z
          .literal('all')
          .describe('Allow all operations available to the authorized credential.'),
      })
      .strict(),
    z
      .object({
        mode: z.literal('allow').describe('Allow only the selected exact operations.'),
        operations: z
          .array(toolNameSchema)
          .max(1000)
          .describe('Allowed exact MCP tool names; an empty list grants no access.'),
      })
      .strict(),
    z
      .object({
        mode: z.literal('deny').describe('Exclude the selected exact operations.'),
        operations: z
          .array(toolNameSchema)
          .max(1000)
          .describe('Denied exact MCP tool names; an empty list allows otherwise permitted tools.'),
      })
      .strict(),
  ])
  .describe(
    'Saved workflow operation restrictions that can only narrow authorized credential access.'
  )

export type McpOperationPolicy = z.output<typeof mcpOperationPolicySchema>

export function isMcpRuntimeReference(value: unknown): value is string {
  return typeof value === 'string' && (/^<[^<>]+>$/.test(value) || /^\{\{[^{}]+\}\}$/.test(value))
}

/** Normalizes interim server-scoped entries and saved configurations predating operation controls. */
export function normalizeMcpOperationPolicy(value: unknown): McpOperationPolicy {
  if (value === undefined || value === null) return { mode: 'all' }
  if (
    isPlainRecord(value) &&
    Array.isArray(value.operations) &&
    value.operations.some(isPlainRecord)
  ) {
    const legacyOperations = z
      .array(z.object({ serverId: z.string().min(1).max(256), name: toolNameSchema }).strict())
      .max(1000)
      .safeParse(value.operations)
    if (!legacyOperations.success) throw new Error('Invalid MCP operations access policy')
    value = { ...value, operations: [...new Set(legacyOperations.data.map(({ name }) => name))] }
  }
  const parsed = mcpOperationPolicySchema.safeParse(value)
  if (!parsed.success) throw new Error('Invalid MCP operations access policy')
  return parsed.data
}

export function permitsMcpOperation(policy: McpOperationPolicy, name: string): boolean {
  if (policy.mode === 'all') return true
  const selected = policy.operations.includes(name)
  return policy.mode === 'allow' ? selected : !selected
}
