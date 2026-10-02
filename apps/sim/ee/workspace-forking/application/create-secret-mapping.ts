import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { workspace, workspaceEnvironment } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import type { CreateForkSecretMappingBody } from '@/lib/api/contracts/workspace-fork'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { encryptSecret } from '@/lib/core/security/encryption'
import { lockWorkspaceEnvMap } from '@/lib/credentials/env-locks'
import { createWorkspaceEnvCredentials } from '@/lib/credentials/environment'
import { invalidateEffectiveDecryptedEnvCache } from '@/lib/environment/utils'
import { getWorkspaceEnvKeys } from '@/lib/workflows/references/resources'
import {
  defineForkUseCase,
  type ForkApplicationContext,
} from '@/ee/workspace-forking/application/authorized-fork-use-case'
import { forkOperations } from '@/ee/workspace-forking/application/operations'
import { acquireForkEdgeLock, setForkLockTimeout } from '@/ee/workspace-forking/lib/lineage/lineage'
import {
  applyForkMappingEntries,
  overlayForkMappingEntries,
} from '@/ee/workspace-forking/lib/mapping/mapping-service'
import { getEdgeMappingRows } from '@/ee/workspace-forking/lib/mapping/mapping-store'

/** Creates a new target secret and its mapping atomically; existing values are never overwritten. */
export const createWorkspaceForkSecretMapping = defineForkUseCase({
  operation: forkOperations.createSecretMapping,
  bothSides: true,
  edge: true,
  async execute({
    input,
    context,
  }: {
    input: CreateForkSecretMappingBody & { workspaceId: string }
    context: ForkApplicationContext
  }) {
    const edge = context.edge!
    const sourceId = input.direction === 'push' ? input.workspaceId : input.otherWorkspaceId
    const targetId = input.direction === 'push' ? input.otherWorkspaceId : input.workspaceId
    const { encrypted } = await encryptSecret(input.value)
    await db.transaction(async (tx) => {
      await setForkLockTimeout(tx)
      await acquireForkEdgeLock(tx, edge.childWorkspaceId)
      const [currentEdge] = await tx
        .select({ parentId: workspace.forkedFromWorkspaceId })
        .from(workspace)
        .where(and(eq(workspace.id, edge.childWorkspaceId), isNull(workspace.archivedAt)))
        .for('update')
        .limit(1)
      if (currentEdge?.parentId !== edge.parentWorkspaceId)
        throw new OrchestrationError('conflict', 'Fork lineage changed')
      if (!(await getWorkspaceEnvKeys(tx, sourceId)).has(input.sourceId))
        throw new OrchestrationError('validation', 'The source secret no longer exists')
      await lockWorkspaceEnvMap(tx, targetId)
      const [row] = await tx
        .select()
        .from(workspaceEnvironment)
        .where(eq(workspaceEnvironment.workspaceId, targetId))
        .limit(1)
      const existing = row?.variables ?? {}
      if (Object.hasOwn(existing, input.name))
        throw new OrchestrationError(
          'conflict',
          'A secret with this name already exists. Select it from the mapping dropdown.'
        )
      const entries = [
        { resourceType: 'env_var' as const, sourceId: input.sourceId, targetId: input.name },
      ]
      overlayForkMappingEntries(
        await getEdgeMappingRows(tx, edge.childWorkspaceId),
        edge,
        sourceId,
        entries
      )
      const variables = { ...existing, [input.name]: encrypted }
      await tx
        .insert(workspaceEnvironment)
        .values({
          id: generateId(),
          workspaceId: targetId,
          variables,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [workspaceEnvironment.workspaceId],
          set: { variables, updatedAt: new Date() },
        })
      await createWorkspaceEnvCredentials({
        workspaceId: targetId,
        newKeys: [input.name],
        actingUserId: context.userId,
        executor: tx,
      })
      await applyForkMappingEntries(tx, edge, context.userId, sourceId, entries)
    })
    return { name: input.name, targetWorkspaceId: targetId }
  },
  projectAudit: ({ result }) => ({
    workspaceId: result.targetWorkspaceId,
    action: AuditAction.ENVIRONMENT_UPDATED,
    resourceType: AuditResourceType.ENVIRONMENT,
    resourceId: result.targetWorkspaceId,
    description: 'Created and mapped an environment secret',
    metadata: { name: result.name },
  }),
  afterSuccess: ({ result }) => {
    invalidateEffectiveDecryptedEnvCache({ workspaceId: result.targetWorkspaceId })
  },
})
