import { createLogger } from '@sim/logger'
import { CREDENTIAL_GROUP_DELEGATION_AUDIENCE } from '@/lib/credential-groups/application/authorization'
import { createCredentialGroupInviteLink } from '@/lib/credential-groups/application/create-invite-link'
import { listCredentialGroupCredentials } from '@/lib/credential-groups/application/list-credentials'
import { listCredentialGroupsForWorkflow } from '@/lib/credential-groups/application/list-groups'
import { listCredentialGroupMcpConnections } from '@/lib/credential-groups/application/list-mcp-connections'
import {
  CREDENTIAL_GROUP_PEOPLE_STATUSES,
  listCredentialGroupPeople,
} from '@/lib/credential-groups/application/list-people'
import { sendCredentialGroupInvite } from '@/lib/credential-groups/application/send-invite'
import { MAX_CREDENTIAL_GROUP_CREDENTIAL_PAGE_SIZE } from '@/lib/credential-groups/credentials'
import type { CredentialGroupEnrollmentStatus } from '@/lib/credential-groups/enrollments'
import { enforceCredentialGroupInvitationExecutionRateLimit } from '@/lib/credential-groups/rate-limit'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/constants'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('CredentialGroupBlockHandler')

const CREDENTIAL_GROUP_OPERATION_IDS = [
  'list_credentials',
  'list_mcp_connections',
  'send_invite',
  'get_invite_link',
  'list_people',
  'list_groups',
] as const

type CredentialGroupOperation = (typeof CREDENTIAL_GROUP_OPERATION_IDS)[number]

function parseOperation(value: unknown): CredentialGroupOperation {
  const operation = typeof value === 'string' ? value : 'list_credentials'
  const supported = CREDENTIAL_GROUP_OPERATION_IDS.find((candidate) => candidate === operation)
  if (!supported) throw new Error(`Unsupported Credential Group operation: ${operation}`)
  return supported
}

function parseStringList(value: unknown, label: string): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined

  let parsed: unknown = value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    if (!trimmed.startsWith('[')) return [trimmed]
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error(`${label} must be a valid JSON array of strings`)
    }
  }

  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string' && item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings`)
  }

  const values = [...new Set(parsed.map((item) => item.trim()))]
  return values.length > 0 ? values : undefined
}

function parseLimit(value: unknown): number {
  const raw = value ?? MAX_CREDENTIAL_GROUP_CREDENTIAL_PAGE_SIZE
  const limit =
    typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : Number.NaN
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CREDENTIAL_GROUP_CREDENTIAL_PAGE_SIZE) {
    throw new Error(
      `Limit must be an integer between 1 and ${MAX_CREDENTIAL_GROUP_CREDENTIAL_PAGE_SIZE}`
    )
  }
  return limit
}

function parseOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function requireString(value: unknown, label: string): string {
  const parsed = parseOptionalString(value, label)
  if (!parsed) throw new Error(`${label} is required`)
  return parsed
}

export class CredentialGroupBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.CREDENTIAL_GROUP
  }

  async execute(
    ctx: ExecutionContext,
    _block: SerializedBlock,
    inputs: Record<string, unknown>
  ): Promise<BlockOutput> {
    if (!ctx.workspaceId) throw new Error('workspaceId is required for Credential Group operations')
    const operation = parseOperation(inputs.operation)
    if (!ctx.executorDelegationOrigin) {
      throw new Error('Credential Group operations require an authenticated workflow execution')
    }
    const credentialGroupId =
      operation === 'list_groups'
        ? undefined
        : requireString(inputs.credentialGroupId, 'Credential Group')
    const principal = await createExecutorPrincipalFromExecutionContext({
      context: ctx,
      audience: CREDENTIAL_GROUP_DELEGATION_AUDIENCE,
      ...(credentialGroupId ? { resourceScope: { credentialGroupId } } : {}),
    })

    switch (operation) {
      case 'list_credentials': {
        const credentialProviderIds = parseStringList(
          inputs.credentialProviderIds,
          'Credential provider IDs'
        )
        const result = await listCredentialGroupCredentials.execute({
          principal,
          input: {
            credentialGroupId: credentialGroupId!,
            limit: parseLimit(inputs.limit),
            cursor: parseOptionalString(inputs.cursor, 'Cursor'),
            email: parseOptionalString(inputs.email, 'Email'),
            credentialProviderIds,
          },
        })
        logger.info('Listed Credential Group credentials', {
          credentialGroupId,
          count: result.count,
          hasMore: result.hasMore,
        })
        return result
      }
      case 'list_mcp_connections': {
        const result = await listCredentialGroupMcpConnections.execute({
          principal,
          input: {
            credentialGroupId: credentialGroupId!,
            limit: parseLimit(inputs.limit),
            cursor: parseOptionalString(inputs.cursor, 'Cursor'),
            email: parseOptionalString(inputs.email, 'Email'),
            mcpServerId: parseOptionalString(inputs.mcpServerId, 'MCP Server ID'),
          },
        })
        logger.info('Listed Credential Group MCP connections', {
          credentialGroupId,
          count: result.count,
          hasMore: result.hasMore,
        })
        return result
      }
      case 'send_invite': {
        await enforceCredentialGroupInvitationExecutionRateLimit(principal.workspaceId)
        const result = await sendCredentialGroupInvite.execute({
          principal,
          input: {
            credentialGroupId: credentialGroupId!,
            email: requireString(inputs.email, 'Email'),
          },
        })
        logger.info('Sent Credential Group invitation', {
          credentialGroupId,
          enrollmentId: result.enrollment.id,
        })
        return {
          enrollmentId: result.enrollment.id,
          email: result.enrollment.email,
          status: result.enrollment.status,
          invitedAt: result.enrollment.invitedAt,
          expiresAt: result.enrollment.expiresAt,
        }
      }
      case 'get_invite_link': {
        await enforceCredentialGroupInvitationExecutionRateLimit(principal.workspaceId)
        const result = await createCredentialGroupInviteLink.execute({
          principal,
          input: {
            credentialGroupId: credentialGroupId!,
            email: requireString(inputs.email, 'Email'),
          },
        })
        logger.info('Generated Credential Group invitation link', {
          credentialGroupId,
          enrollmentId: result.enrollment.id,
        })
        return {
          enrollmentId: result.enrollment.id,
          email: result.enrollment.email,
          status: result.enrollment.status,
          invitedAt: result.enrollment.invitedAt,
          expiresAt: result.enrollment.expiresAt,
          invitationLink: result.invitationLink,
        }
      }
      case 'list_people': {
        const statuses = parseStringList(inputs.peopleStatuses, 'People statuses')
        const allowedStatuses = new Set<string>(CREDENTIAL_GROUP_PEOPLE_STATUSES)
        if (statuses?.some((status) => !allowedStatuses.has(status))) {
          throw new Error('People statuses contain an unsupported value')
        }
        const result = await listCredentialGroupPeople.execute({
          principal,
          input: {
            credentialGroupId: credentialGroupId!,
            limit: parseLimit(inputs.limit),
            cursor: parseOptionalString(inputs.cursor, 'Cursor'),
            email: parseOptionalString(inputs.email, 'Email'),
            statuses: statuses as CredentialGroupEnrollmentStatus[] | undefined,
          },
        })
        logger.info('Listed Credential Group people', {
          credentialGroupId,
          count: result.count,
          hasMore: result.hasMore,
        })
        return result
      }
      case 'list_groups': {
        const result = await listCredentialGroupsForWorkflow.execute({
          principal,
          input: {
            workspaceId: ctx.workspaceId,
            limit: parseLimit(inputs.limit),
            cursor: parseOptionalString(inputs.cursor, 'Cursor'),
          },
        })
        logger.info('Listed Credential Groups', {
          workspaceId: ctx.workspaceId,
          count: result.count,
          hasMore: result.hasMore,
        })
        return result
      }
    }
  }
}
