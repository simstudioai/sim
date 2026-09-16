import { z } from 'zod'
import { organizationSearchSourcesInputSchema } from './mothership-search-sources'
import { mothershipSettingsInputSchema } from './mothership-settings'

/** Shared input contracts and availability; permission decisions remain in the domain use cases. */
export const managementToolContracts = [
  {
    id: 'settings',
    route: 'sim',
    scope: 'all',
    description:
      'Read and manage account, organization, and workspace settings. list finds sections; get returns current values, updateSchema and operation names; describe returns one operation’s exact input schema; update changes narrow preferences; execute performs a listed operation; open returns the existing user setup flow. When user setup is needed, put the returned setupUrl in a clickable Markdown link at the end of the reply. Workspace resources retain their CLI commands. Account is the acting user; organization is the conversation’s organization. Every operation checks current permissions and entitlements.',
    inputSchema: mothershipSettingsInputSchema,
  },
  {
    id: 'search_sources',
    route: 'sim',
    scope: 'organization',
    description:
      'Discover and configure organization Search sources. list/get return accessible sources and indexing status; providers returns available integration approvals; approve changes a provider approval when authorized; setup returns the existing connection UI for the user to complete. Put the returned setupUrl in a clickable Markdown link at the end of the reply. Setup does not mean connected or indexed. Use search_workspace and read_document to retrieve source content.',
    inputSchema: organizationSearchSourcesInputSchema,
  },
] as const

export const managementToolDefinitions = managementToolContracts.map(
  ({ inputSchema, ...definition }) => ({
    ...definition,
    parameters: z.toJSONSchema(actionToolObject(inputSchema.options), {
      target: 'draft-7',
      io: 'input',
    }),
  })
)

/** Anthropic requires an object root. Derive its fields; the canonical union still validates calls. */
function actionToolObject(
  options: readonly z.ZodObject<{ action: z.ZodLiteral<string>; [key: string]: z.ZodType }>[]
): z.ZodObject {
  const fields = new Map<
    string,
    { schemas: Set<z.ZodType>; actions: string[]; requiredActions: string[] }
  >()
  for (const option of options) {
    const action = option.shape.action
    for (const [name, schema] of Object.entries(option.shape)) {
      const field = fields.get(name) ?? {
        schemas: new Set<z.ZodType>(),
        actions: [],
        requiredActions: [],
      }
      field.schemas.add(schema)
      field.actions.push(action.value)
      if (!schema.isOptional()) field.requiredActions.push(action.value)
      fields.set(name, field)
    }
  }
  const shape: Record<string, z.ZodType> = {}
  for (const [name, field] of fields) {
    const schemas = [...field.schemas]
    let schema = schemas.length === 1 ? schemas[0] : z.union(schemas)
    if (field.actions.length < options.length) {
      schema = schema
        .optional()
        .describe(
          [
            schema.description,
            field.requiredActions.length
              ? `Required for action: ${field.requiredActions.join(', ')}.`
              : '',
            `Only used for action: ${field.actions.join(', ')}. Omit for other actions.`,
          ]
            .filter(Boolean)
            .join(' ')
        )
    }
    shape[name] = schema
  }
  return z.strictObject(shape)
}
