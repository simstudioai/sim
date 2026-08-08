import type { DelegatedPrincipal } from '@sim/auth/principal'
import { TABLE_DELEGATION_AUDIENCE } from '@/lib/table/application/authorization'

const TABLE_DELEGATION_TTL_MS = 5 * 60 * 1000

export interface TableDelegationInput {
  serviceId: DelegatedPrincipal['serviceId']
  subjectUserId: string
  workspaceId: string
  delegationId: string
  tableId?: string
  chatId?: string
  executionId?: string
}

export function createTableDelegatedPrincipal(input: TableDelegationInput): DelegatedPrincipal {
  if (!input.subjectUserId || !input.workspaceId || !input.delegationId) {
    throw new Error('Table delegation requires subject, workspace, and delegation IDs')
  }
  const issuedAt = new Date()
  return {
    kind: 'delegated',
    serviceId: input.serviceId,
    subjectUserId: input.subjectUserId,
    workspaceId: input.workspaceId,
    delegationId: input.delegationId,
    audience: TABLE_DELEGATION_AUDIENCE,
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + TABLE_DELEGATION_TTL_MS),
    resourceScope: {
      ...(input.tableId ? { tableId: input.tableId } : {}),
      ...(input.chatId ? { chatId: input.chatId } : {}),
      ...(input.executionId ? { executionId: input.executionId } : {}),
    },
  }
}
