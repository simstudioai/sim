import { z } from 'zod'
import { workflowIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import { CODEX_AGENT_ID_PATTERN, CODEX_CONFIG_VERSION, CODEX_MODES } from '@/lib/codex/config'
import { CODEX_MODELS, CODEX_REASONING_EFFORTS } from '@/providers/codex'

const boundedConfigString = z.string().trim().min(1).max(255)

export const codexConfigPatchSchema = z
  .object({
    mode: z.enum(CODEX_MODES).optional(),
    model: z.enum(CODEX_MODELS).optional(),
    owner: boundedConfigString.optional(),
    repo: boundedConfigString.optional(),
    baseBranch: boundedConfigString.nullable().optional(),
    reasoningEffort: z.enum(CODEX_REASONING_EFFORTS).optional(),
    networkAccess: z.boolean().optional(),
  })
  .strict()

const agentIdSchema = z
  .string()
  .regex(
    CODEX_AGENT_ID_PATTERN,
    'Agent ID must contain only letters, numbers, dots, underscores, or hyphens'
  )

export const codexWorkflowConfigSchema = z
  .object({
    version: z.literal(CODEX_CONFIG_VERSION),
    defaults: codexConfigPatchSchema,
    agents: z.record(agentIdSchema, codexConfigPatchSchema),
  })
  .strict()
  .refine((config) => Object.keys(config.agents).length <= 100, {
    message: 'A workflow can configure at most 100 Codex agents',
    path: ['agents'],
  })

const workspaceParamsSchema = z.object({ id: workspaceIdSchema })
const workflowParamsSchema = z.object({ id: workflowIdSchema })

export const getWorkspaceCodexConfigContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/codex-config',
  params: workspaceParamsSchema,
  response: { mode: 'json', schema: z.object({ config: codexConfigPatchSchema }) },
})

export const updateWorkspaceCodexConfigContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workspaces/[id]/codex-config',
  params: workspaceParamsSchema,
  body: z.object({ config: codexConfigPatchSchema }).strict(),
  response: { mode: 'json', schema: z.object({ config: codexConfigPatchSchema }) },
})

export const getWorkflowCodexConfigContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/codex-config',
  params: workflowParamsSchema,
  response: { mode: 'json', schema: z.object({ config: codexWorkflowConfigSchema }) },
})

export const updateWorkflowCodexConfigContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workflows/[id]/codex-config',
  params: workflowParamsSchema,
  body: z.object({ config: codexWorkflowConfigSchema }).strict(),
  response: { mode: 'json', schema: z.object({ config: codexWorkflowConfigSchema }) },
})

export type WorkspaceCodexConfigResponse = ContractJsonResponse<
  typeof getWorkspaceCodexConfigContract
>
export type WorkflowCodexConfigResponse = ContractJsonResponse<
  typeof getWorkflowCodexConfigContract
>
