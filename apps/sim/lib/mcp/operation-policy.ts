import { z } from 'zod'

const operationIdentitySchema = z
  .object({
    serverId: z
      .string()
      .min(1, 'Canonical MCP server ID is required')
      .max(256)
      .describe('Canonical MCP server identity, independent of the selected credential.'),
    name: z
      .string()
      .min(1, 'Operation name is required')
      .max(256)
      .describe('Exact operation name returned by MCP discovery.'),
  })
  .strict()

/** Exact MCP names are scoped to the canonical server, never to a credential or display label. */
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
          .array(operationIdentitySchema)
          .max(1000)
          .describe('Allowed server-scoped operation identities; an empty list grants no access.'),
      })
      .strict(),
    z
      .object({
        mode: z.literal('deny').describe('Exclude the selected exact operations.'),
        operations: z
          .array(operationIdentitySchema)
          .max(1000)
          .describe(
            'Denied server-scoped operation identities; an empty list allows otherwise permitted tools.'
          ),
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

/** Pre-action MCP blocks stored server-prefixed selections; current blocks store exact names. */
export function normalizeSavedMcpOperationName(values: {
  server?: unknown
  tool?: unknown
  operation?: unknown
  operationPolicy?: unknown
}): unknown {
  const { server, tool } = values
  return !values.operation &&
    !values.operationPolicy &&
    typeof server === 'string' &&
    typeof tool === 'string' &&
    tool.startsWith(`${server}-`)
    ? tool.slice(server.length + 1)
    : tool
}

/** Saved configurations predating operation controls normalize once to all otherwise permitted tools. */
export function normalizeMcpOperationPolicy(value: unknown): McpOperationPolicy {
  if (value === undefined || value === null) return { mode: 'all' }
  const parsed = mcpOperationPolicySchema.safeParse(value)
  if (!parsed.success) throw new Error('Invalid MCP operations access policy')
  return parsed.data
}

export function permitsMcpOperation(
  policy: McpOperationPolicy,
  serverId: string,
  name: string
): boolean {
  if (policy.mode === 'all') return true
  const selected = policy.operations.some(
    (operation) => operation.serverId === serverId && operation.name === name
  )
  return policy.mode === 'allow' ? selected : !selected
}
