import { z } from 'zod'
import { noInputSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { columnTypeSchema } from '@/lib/api/contracts/tables'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'

/**
 * Most resources of one kind the manifest lists, oldest first. Past it the manifest says
 * `truncated`; source can still name a later resource by its key.
 */
export const MAX_MANIFEST_RESOURCES_PER_KIND = 1000

const v2SourceResourcesParamsSchema = z
  .object({ workspaceId: workspaceIdSchema.describe('Workspace whose resources to list.') })
  .strict()

const resourceKeySchema = z
  .string()
  .describe('The key workflow source names this resource by; it never changes once assigned.')

const manifestResourceSchema = z.object({
  key: resourceKeySchema,
  id: z.string().describe('Resource id.'),
  name: z.string().describe('Current display name.'),
})

const sourceResourcesSchema = z
  .object({
    workspaceId: z.string().describe('Workspace id.'),
    tables: z
      .array(
        manifestResourceSchema
          .extend({
            columns: z
              .array(
                z.object({
                  name: z.string().describe('Column name, as row data names it.'),
                  type: columnTypeSchema.describe(
                    'Column type, e.g. `string`, `number`, `boolean`, `json`, `select`.'
                  ),
                  options: z
                    .array(z.string())
                    .optional()
                    .describe(
                      'Option names a `select` column accepts, as table blocks read and write them.'
                    ),
                  multiple: z
                    .boolean()
                    .optional()
                    .describe('A `select` column whose cells hold several options.'),
                  required: z.boolean().optional().describe('Every row holds a value.'),
                })
              )
              .describe('Columns in table order.'),
          })
          .describe('A table: `table(key)`.')
      )
      .describe('Tables, oldest first.'),
    knowledgeBases: z
      .array(manifestResourceSchema.describe('A knowledge base: `knowledgeBase(key)`.'))
      .describe('Knowledge bases, oldest first.'),
    credentials: z
      .array(
        manifestResourceSchema
          .extend({
            provider: z
              .string()
              .describe('The provider the credential is for, e.g. `slack` or `google-email`.'),
          })
          .describe('A saved credential: `credential(key)`.')
      )
      .describe('Saved credentials, oldest first. Secrets are listed under `env`.'),
    workflows: z
      .array(
        manifestResourceSchema
          .extend({
            inputs: z
              .array(
                z.object({
                  name: z.string().describe('Input field name.'),
                  type: z.string().describe('Input field type, e.g. `string` or `number`.'),
                })
              )
              .describe('Inputs the workflow start block declares.'),
          })
          .describe('A workflow: `childWorkflow(key)`.')
      )
      .describe('Workflows, oldest first.'),
    skills: z
      .array(manifestResourceSchema.describe('A workspace skill: `skill(key)`.'))
      .describe('Workspace skills, oldest first. Built-in skills have no key and are not listed.'),
    customTools: z
      .array(
        manifestResourceSchema.describe('A workspace custom tool, by its title: `customTool(key)`.')
      )
      .describe('Workspace custom tools, oldest first.'),
    mcpServers: z
      .array(
        manifestResourceSchema
          .extend({
            tools: z
              .array(z.string())
              .optional()
              .describe(
                'Tool names the server listed, for `mcp(key).tool(name)`; absent when it could not be listed (unreachable, or not listable by this caller).'
              ),
          })
          .describe('An MCP server the workspace consumes: `mcp(key)`.')
      )
      .describe('MCP servers, oldest first.'),
    env: z
      .array(z.string())
      .describe(
        'Environment variable names a run can read as `env.NAME`: the workspace secrets and, for a user, their personal ones. Never values.'
      ),
    truncated: z
      .boolean()
      .describe(
        `True when a kind had more than ${MAX_MANIFEST_RESOURCES_PER_KIND} resources; only the oldest ${MAX_MANIFEST_RESOURCES_PER_KIND} of that kind are listed.`
      ),
  })
  .describe('The workspace resources workflow source can name, by key.')

export type SourceResources = z.output<typeof sourceResourcesSchema>

/** `GET /api/v2/workspaces/{workspaceId}/workflows/source/resources`: resources source can name. */
export const v2GetSourceResourcesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workspaces/[workspaceId]/workflows/source/resources',
  params: v2SourceResourcesParamsSchema,
  query: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(sourceResourcesSchema) },
})
