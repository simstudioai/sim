import { z } from 'zod'
import { noInputSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'

const v2ResourceManifestParamsSchema = z
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

const resourceManifestSchema = z
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
                  type: z
                    .string()
                    .describe('Column type, e.g. `string`, `number`, `boolean`, `json`, `select`.'),
                  options: z
                    .array(z.string())
                    .optional()
                    .describe('Option ids a `select` column accepts.'),
                })
              )
              .describe('Columns in table order.'),
          })
          .describe('A table: `table(key)`.')
      )
      .describe('Tables, oldest first.'),
    knowledgeBases: z
      .array(manifestResourceSchema.describe('A knowledge base: `kb(key)`.'))
      .describe('Knowledge bases, oldest first.'),
    bindings: z
      .array(
        manifestResourceSchema
          .extend({
            service: z
              .string()
              .describe('The provider the credential is for, e.g. `slack` or `google-email`.'),
          })
          .describe('A saved credential: `binding(key)`.')
      )
      .describe('Credential bindings, oldest first. Secrets are listed under `env`.'),
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
          .describe('A workflow: `workflow(key)`.')
      )
      .describe('Workflows, oldest first.'),
    env: z
      .array(z.string())
      .describe(
        'Environment variable names a run can read as `env.NAME`: the workspace secrets and, for a user, their personal ones. Never values.'
      ),
    truncated: z
      .boolean()
      .describe(
        'True when a kind had more than 1000 resources; only the oldest 1000 of that kind are listed.'
      ),
  })
  .describe('The workspace resources workflow source can name, by key.')

/** `GET /api/v2/workspaces/{workspaceId}/resource-manifest`: resources workflow source can name. */
export const v2GetResourceManifestContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workspaces/[workspaceId]/resource-manifest',
  params: v2ResourceManifestParamsSchema,
  query: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(resourceManifestSchema) },
})
