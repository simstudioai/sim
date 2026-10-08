import { z } from 'zod'
import { mothershipDashboardsInputSchema } from '@/lib/api/contracts/mothership-dashboards'
import { mothershipTestsInputSchema } from '@/lib/api/contracts/mothership-tests'
import { createWorkspaceInputSchema } from '@/lib/workspaces/create-input'
import { organizationSearchSourcesInputSchema } from './mothership-search-sources'
import { mothershipSettingsInputSchema } from './mothership-settings'

export const mothershipWorkspacesInputSchema = z.discriminatedUnion('action', [
  createWorkspaceInputSchema.extend({ action: z.literal('create') }).strict(),
])

/** Shared input contracts and availability; permission decisions remain in the domain use cases. */
export const managementToolContracts = [
  {
    id: 'dashboards',
    route: 'sim',
    scope: 'all',
    description:
      'Read and save the selected workspace’s single dashboard, validated YAML over live tables. Load the create-dashboard skill for the schema. get returns content and revision, or nulls when the workspace has no dashboard yet; set with no revision creates it. Replacing an existing dashboard requires expectedRevision from get, so a concurrent edit is never overwritten. Use open_resource with type dashboard to show the result.',
    inputSchema: mothershipDashboardsInputSchema,
  },
  {
    id: 'tests',
    route: 'sim',
    scope: 'all',
    description:
      'Create and run the selected workspace\u2019s workflow tests. create takes a name, a one-line title for the concern, and an optional description, and returns tests/<name>.test.js; write the cases into that file with the file tools. A test file is plain vitest: import { describe, it, expect, vi } from "vitest" and { runWorkflow, mockBlock, mockTool, spyOnBlock } from "sim:test", one top-level describe, an it per case. runWorkflow(name, input) runs a workflow and returns { output } (pass { trigger: \"Trigger block name\" } as a third argument when it has several triggers); mockBlock(blockName) returns a vi.fn whose value replaces that block\u2019s output and records its inputs; mockTool(toolId) or mockTool(agentBlockName, toolId) answers an Agent\u2019s calls to that tool the same way while the model still runs; .mockSampleOutput({ ...overrides }) on either mock returns a placeholder output shaped like the real one, with your fields merged in; await expect(value).toMatchRubric(rubric) asks a model judge for pass or fail. Every write is checked and refused if the file does not load. run takes a version (draft while editing, deployed before shipping), waits, and returns each file\u2019s failures with line numbers and messages. list and get report status; update changes title or description.',
    inputSchema: mothershipTestsInputSchema,
  },
  {
    id: 'workspaces',
    route: 'sim',
    scope: 'organization',
    description:
      'Create a workspace in the conversation’s organization under the current user’s workspace-creation policy. Returns its ID for subsequent explicitly workspace-scoped commands. Includes a starter workflow unless skipDefaultWorkflow is true.',
    inputSchema: mothershipWorkspacesInputSchema,
  },
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
    actionSchemas: Object.fromEntries(
      inputSchema.options.map((option) => [
        option.shape.action.value,
        z.toJSONSchema(option, { target: 'draft-7', io: 'input' }),
      ])
    ),
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
