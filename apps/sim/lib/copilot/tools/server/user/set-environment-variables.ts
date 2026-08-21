import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { SetEnvironmentVariables } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  ensureWorkflowAccess,
  ensureWorkspaceAccess,
  getDefaultWorkspaceId,
} from '@/lib/copilot/tools/handlers/access'
import type { BaseServerTool, ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { performUpdateCredential } from '@/lib/credentials/orchestration'
import { listVisibleWorkspaceCredentials } from '@/lib/credentials/queries'
import { upsertPersonalEnvVars, upsertWorkspaceEnvVars } from '@/lib/environment/utils'

type EnvironmentVariableInputValue = string | number | boolean | null | undefined

interface EnvironmentVariableInput {
  name: string
  value: EnvironmentVariableInputValue
  description?: string | null
}

/** Matches the secret detail form and `PUT /api/v2/secrets`. */
const DESCRIPTION_MAX_LENGTH = 500

interface SetEnvironmentVariablesParams {
  variables: Record<string, EnvironmentVariableInputValue> | EnvironmentVariableInput[]
  scope?: 'personal' | 'workspace'
  workflowId?: string
  workspaceId?: string
}

interface SetEnvironmentVariablesResult {
  message: string
  scope: 'personal' | 'workspace'
  workspaceId?: string
  variableCount: number
  variableNames: string[]
  addedVariables: string[]
  updatedVariables: string[]
  workspaceUpdatedVariables: string[]
  describedVariables: string[]
}

const EnvVarSchema = z.object({ variables: z.record(z.string(), z.string()) })

/** A row that only annotates a secret that already exists — it sends no value. */
function isDescriptionOnly(item: EnvironmentVariableInput): boolean {
  return (
    (item.value === undefined || item.value === null) &&
    typeof item.description === 'string' &&
    item.description.trim().length > 0
  )
}

/**
 * Collects the descriptions the model actually sent. A variable that omits the
 * field is absent from the result, so an existing description survives a value
 * rotation; a blank one clears it. The object form of `variables` carries none.
 */
function normalizeDescriptions(
  input: Record<string, EnvironmentVariableInputValue> | EnvironmentVariableInput[]
): Record<string, string | null> {
  if (!Array.isArray(input)) return {}

  const descriptions: Record<string, string | null> = {}
  for (const item of input) {
    if (!item || typeof item.name !== 'string' || item.description === undefined) continue
    const description = item.description?.trim() ?? ''
    if (description.length > DESCRIPTION_MAX_LENGTH) {
      throw new OrchestrationError(
        'validation',
        `description for ${item.name} must be at most ${DESCRIPTION_MAX_LENGTH} characters`
      )
    }
    descriptions[item.name] = description === '' ? null : description
  }
  return descriptions
}

/**
 * Values to write. An array item that carries a description but no value is a
 * description-only edit and is deliberately absent here: coercing its missing
 * value to `''` would blank the very secret the model is trying to annotate.
 */
function normalizeVariables(
  input: Record<string, EnvironmentVariableInputValue> | EnvironmentVariableInput[]
): Record<string, string> {
  if (Array.isArray(input)) {
    return input.reduce(
      (acc, item) => {
        if (item && typeof item.name === 'string' && !isDescriptionOnly(item)) {
          acc[item.name] = String(item.value ?? '')
        }
        return acc
      },
      {} as Record<string, string>
    )
  }
  return Object.fromEntries(
    Object.entries(input || {}).map(([k, v]) => [k, String(v ?? '')])
  ) as Record<string, string>
}

/**
 * Writes descriptions onto secrets, never their values. Resolves each key to its
 * credential row and hands it to `performUpdateCredential` — the same handler the
 * secrets settings page calls — so credential-admin access, the `env_personal`
 * refusal, and the audit record are all decided in one place.
 *
 * Only the `description` column is touched. Re-sending the value to attach a note
 * would clobber a rotation that landed between the two writes, and the note is
 * never worth losing someone else's secret over.
 */
async function describeSecrets(params: {
  workspaceId: string
  userId: string
  descriptions: Record<string, string | null>
}): Promise<{ described: string[]; failures: string[] }> {
  const names = Object.keys(params.descriptions)
  if (names.length === 0) return { described: [], failures: [] }

  const { data: credentials } = await listVisibleWorkspaceCredentials({
    workspaceId: params.workspaceId,
    userId: params.userId,
    workspaceAccess: { canAdmin: false },
    types: ['env_workspace'],
  })
  const idByEnvKey = new Map(
    credentials.flatMap((row) => (row.envKey ? [[row.envKey, row.id] as const] : []))
  )

  const described: string[] = []
  const failures: string[] = []
  for (const name of names) {
    const credentialId = idByEnvKey.get(name)
    if (!credentialId) {
      failures.push(`no workspace secret named ${name}`)
      continue
    }
    const result = await performUpdateCredential({
      credentialId,
      userId: params.userId,
      description: params.descriptions[name],
      allowedTypes: ['env_workspace'],
    })
    if (result.success) {
      described.push(name)
    } else {
      failures.push(`${name}: ${result.error ?? 'could not be described'}`)
    }
  }
  return { described, failures }
}

async function resolveWorkspaceId(
  params: SetEnvironmentVariablesParams,
  context: ServerToolContext | undefined,
  userId: string
): Promise<string> {
  if (params.workflowId) {
    const { workflow } = await ensureWorkflowAccess(params.workflowId, userId, 'write')
    if (!workflow.workspaceId) {
      throw new OrchestrationError(
        'validation',
        `Workflow ${params.workflowId} is not associated with a workspace`
      )
    }
    return workflow.workspaceId
  }

  const workspaceId = params.workspaceId ?? context?.workspaceId
  if (workspaceId) {
    await ensureWorkspaceAccess(workspaceId, userId, 'write')
    return workspaceId
  }

  return getDefaultWorkspaceId(userId)
}

export const setEnvironmentVariablesServerTool: BaseServerTool<
  SetEnvironmentVariablesParams,
  SetEnvironmentVariablesResult
> = {
  name: SetEnvironmentVariables.id,
  async execute(
    params: SetEnvironmentVariablesParams,
    context?: ServerToolContext
  ): Promise<SetEnvironmentVariablesResult> {
    const logger = createLogger('SetEnvironmentVariablesServerTool')

    if (!context?.userId) {
      logger.error(
        'Unauthorized attempt to set environment variables - no authenticated user context'
      )
      throw new Error('Authentication required')
    }

    const authenticatedUserId = context.userId
    const { variables } = params || ({} as SetEnvironmentVariablesParams)
    const scope = params.scope === 'personal' ? 'personal' : 'workspace'

    const normalized = normalizeVariables(variables || {})
    const descriptions = normalizeDescriptions(variables || {})
    // Rejected rather than dropped, matching `PUT /api/v2/secrets` and the domain
    // layer: a personal secret's value is user-global, but its credential rows are
    // per-workspace mirrors, so there is no single row to hold its description —
    // one written here would exist in this workspace alone.
    if (scope === 'personal' && Object.keys(descriptions).length > 0) {
      throw new OrchestrationError(
        'validation',
        'description is only supported for a workspace secret'
      )
    }
    const { variables: validatedVariables } = EnvVarSchema.parse({ variables: normalized })
    const variableNames = Object.keys(validatedVariables)
    const added: string[] = []
    const updated: string[] = []
    let workspaceUpdated: string[] = []
    let described: string[] = []
    let descriptionFailures: string[] = []

    let resolvedWorkspaceId: string | undefined
    if (scope === 'workspace') {
      resolvedWorkspaceId = await resolveWorkspaceId(params, context, authenticatedUserId)
      workspaceUpdated = await upsertWorkspaceEnvVars(
        resolvedWorkspaceId,
        validatedVariables,
        authenticatedUserId
      )
      // Runs after the value write, which is what mints the credential row a
      // brand-new key's description hangs on.
      const outcome = await describeSecrets({
        workspaceId: resolvedWorkspaceId,
        userId: authenticatedUserId,
        descriptions,
      })
      described = outcome.described
      descriptionFailures = outcome.failures
    } else {
      const result = await upsertPersonalEnvVars(authenticatedUserId, validatedVariables)
      added.push(...result.added)
      updated.push(...result.updated)
    }

    const totalProcessed = added.length + updated.length + workspaceUpdated.length

    logger.info('Saved environment variables', {
      userId: authenticatedUserId,
      scope,
      addedCount: added.length,
      updatedCount: updated.length,
      workspaceUpdatedCount: workspaceUpdated.length,
      workspaceId: resolvedWorkspaceId,
    })

    // A failed description never fails a stored value — but a describe-only call
    // has nothing else to report, so its failure is the result.
    if (descriptionFailures.length > 0 && workspaceUpdated.length === 0) {
      throw new OrchestrationError(
        'conflict',
        `Could not describe: ${descriptionFailures.join('; ')}`
      )
    }

    const parts: string[] = []
    if (added.length > 0) parts.push(`${added.length} personal secret(s) added`)
    if (updated.length > 0) parts.push(`${updated.length} personal secret(s) updated`)
    if (workspaceUpdated.length > 0)
      parts.push(`${workspaceUpdated.length} workspace secret(s) updated`)
    if (described.length > 0) parts.push(`${described.length} description(s) saved`)
    if (descriptionFailures.length > 0)
      parts.push(`descriptions not saved (${descriptionFailures.join('; ')})`)

    return {
      message: `Successfully processed ${totalProcessed} secret(s): ${parts.join(', ')}`,
      scope,
      workspaceId: resolvedWorkspaceId,
      variableCount: variableNames.length,
      variableNames,
      addedVariables: added,
      updatedVariables: updated,
      workspaceUpdatedVariables: workspaceUpdated,
      describedVariables: described,
    }
  },
}
