import { db } from '@sim/db'
import { resourcePolicy } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import {
  parseResourcePolicyDocument,
  type ResourcePolicyDocument,
  type ResourcePolicyResourceType,
} from '@/lib/resource-policies/types'

export interface StoredResourcePolicy {
  id: string
  workspaceId: string
  revision: number
  document: ResourcePolicyDocument
  createdAt: Date
  updatedAt: Date
}

export class ResourcePolicyRevisionConflictError extends Error {
  constructor() {
    super('Resource policy changed while it was being edited')
    this.name = 'ResourcePolicyRevisionConflictError'
  }
}

export async function loadResourcePolicy(input: {
  resourceType: ResourcePolicyResourceType
  resourceId: string
}): Promise<StoredResourcePolicy | null> {
  const [row] = await db
    .select()
    .from(resourcePolicy)
    .where(
      and(
        eq(resourcePolicy.resourceType, input.resourceType),
        eq(resourcePolicy.resourceId, input.resourceId)
      )
    )
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    revision: row.revision,
    document: parseResourcePolicyDocument(row.document, {
      type: input.resourceType,
      id: input.resourceId,
    }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function writeResourcePolicy(input: {
  workspaceId: string
  resourceType: ResourcePolicyResourceType
  resourceId: string
  expectedRevision: number
  document: ResourcePolicyDocument
  actorUserId: string
}): Promise<StoredResourcePolicy> {
  const document = parseResourcePolicyDocument(input.document, {
    type: input.resourceType,
    id: input.resourceId,
  })
  const now = new Date()
  if (input.expectedRevision === 0) {
    const [created] = await db
      .insert(resourcePolicy)
      .values({
        id: generateId(),
        workspaceId: input.workspaceId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        revision: 1,
        document,
        createdBy: input.actorUserId,
        updatedBy: input.actorUserId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning()
    if (!created) throw new ResourcePolicyRevisionConflictError()
    return {
      id: created.id,
      workspaceId: created.workspaceId,
      revision: created.revision,
      document,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    }
  }

  const [updated] = await db
    .update(resourcePolicy)
    .set({
      document,
      revision: input.expectedRevision + 1,
      updatedBy: input.actorUserId,
      updatedAt: now,
    })
    .where(
      and(
        eq(resourcePolicy.resourceType, input.resourceType),
        eq(resourcePolicy.resourceId, input.resourceId),
        eq(resourcePolicy.workspaceId, input.workspaceId),
        eq(resourcePolicy.revision, input.expectedRevision)
      )
    )
    .returning()
  if (!updated) throw new ResourcePolicyRevisionConflictError()
  return {
    id: updated.id,
    workspaceId: updated.workspaceId,
    revision: updated.revision,
    document,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  }
}
