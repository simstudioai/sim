import { db } from '@sim/db'
import { resourcePolicy } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import type { DbOrTx } from '@/lib/db/types'
import type {
  ResourcePolicyCodec,
  ResourcePolicyDocument,
  ResourcePolicyResourceType,
  ResourcePolicyTarget,
} from '@/lib/resource-policies/types'

export interface StoredResourcePolicy<
  ResourceType extends ResourcePolicyResourceType,
  Document extends ResourcePolicyDocument<ResourceType>,
> {
  id: string
  workspaceId: string | null
  organizationId: string | null
  revision: number
  document: Document
  createdAt: Date
  updatedAt: Date
}

export class ResourcePolicyNotFoundError extends Error {
  constructor(resourceType: ResourcePolicyResourceType, resourceId: string) {
    super(`Required resource policy is missing for ${resourceType} ${resourceId}`)
    this.name = 'ResourcePolicyNotFoundError'
  }
}

export class ResourcePolicyRevisionConflictError extends Error {
  constructor() {
    super('Resource policy changed while it was being edited')
    this.name = 'ResourcePolicyRevisionConflictError'
  }
}

type CodecTarget<
  ResourceType extends ResourcePolicyResourceType,
  Document extends ResourcePolicyDocument<ResourceType>,
> = ResourcePolicyTarget<ResourceType> & {
  codec: ResourcePolicyCodec<ResourceType, Document>
}

function requireMatchingCodec<ResourceType extends ResourcePolicyResourceType>(
  resourceType: ResourceType,
  codec: { readonly resourceType: ResourcePolicyResourceType }
): void {
  if (codec.resourceType !== resourceType) {
    throw new Error(
      `Resource policy codec ${codec.resourceType} cannot parse resource type ${resourceType}`
    )
  }
}

async function loadResourcePolicyWithExecutor<
  ResourceType extends ResourcePolicyResourceType,
  Document extends ResourcePolicyDocument<ResourceType>,
>(
  input: CodecTarget<ResourceType, Document>,
  executor: DbOrTx,
  options: { forUpdate?: boolean } = {}
): Promise<StoredResourcePolicy<ResourceType, Document> | null> {
  requireMatchingCodec(input.resourceType, input.codec)
  const query = executor
    .select()
    .from(resourcePolicy)
    .where(
      and(
        resourceScopeCondition(resourcePolicy, resourceScopeFromOwner(input)),
        eq(resourcePolicy.resourceType, input.resourceType),
        eq(resourcePolicy.resourceId, input.resourceId)
      )
    )
    .limit(1)
  const rows = options.forUpdate ? await query.for('update') : await query
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    organizationId: row.organizationId,
    revision: row.revision,
    document: input.codec.parse(row.document, {
      type: input.resourceType,
      id: input.resourceId,
    }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function requireResourcePolicy<
  ResourceType extends ResourcePolicyResourceType,
  Document extends ResourcePolicyDocument<ResourceType>,
>(
  input: CodecTarget<ResourceType, Document>,
  executor: DbOrTx = db
): Promise<StoredResourcePolicy<ResourceType, Document>> {
  const policy = await loadResourcePolicyWithExecutor(input, executor)
  if (!policy) throw new ResourcePolicyNotFoundError(input.resourceType, input.resourceId)
  return policy
}

export async function writeResourcePolicy<
  ResourceType extends ResourcePolicyResourceType,
  Document extends ResourcePolicyDocument<ResourceType>,
>(
  input: CodecTarget<ResourceType, Document> & {
    expectedRevision: number
    document: Document
    actorUserId: string
  }
): Promise<StoredResourcePolicy<ResourceType, Document>> {
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new Error('Expected resource policy revision must be a positive integer')
  }
  const document = input.codec.parse(input.document, {
    type: input.resourceType,
    id: input.resourceId,
  })

  return db.transaction(async (tx) => {
    const existing = await loadResourcePolicyWithExecutor(input, tx, { forUpdate: true })
    if (!existing) throw new ResourcePolicyNotFoundError(input.resourceType, input.resourceId)
    if (existing.revision !== input.expectedRevision) {
      throw new ResourcePolicyRevisionConflictError()
    }

    const [updated] = await tx
      .update(resourcePolicy)
      .set({
        document,
        revision: input.expectedRevision + 1,
        updatedBy: input.actorUserId,
        updatedAt: new Date(),
      })
      .where(
        and(eq(resourcePolicy.id, existing.id), eq(resourcePolicy.revision, input.expectedRevision))
      )
      .returning()
    if (!updated) throw new Error('Locked resource policy update returned no row')
    return {
      id: updated.id,
      workspaceId: updated.workspaceId,
      organizationId: updated.organizationId,
      revision: updated.revision,
      document,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    }
  })
}

export async function deleteResourcePolicyForResource<
  ResourceType extends ResourcePolicyResourceType,
>(input: ResourcePolicyTarget<ResourceType>, executor: DbOrTx): Promise<void> {
  const deleted = await executor
    .delete(resourcePolicy)
    .where(
      and(
        resourceScopeCondition(resourcePolicy, resourceScopeFromOwner(input)),
        eq(resourcePolicy.resourceType, input.resourceType),
        eq(resourcePolicy.resourceId, input.resourceId)
      )
    )
    .returning({ id: resourcePolicy.id })
  if (deleted.length !== 1) {
    throw new ResourcePolicyNotFoundError(input.resourceType, input.resourceId)
  }
}
