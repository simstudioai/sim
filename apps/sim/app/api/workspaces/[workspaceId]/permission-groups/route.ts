import { db } from '@sim/db'
import { permissionGroup, permissionGroupMember, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, count, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { getSession } from '@/lib/auth'
import { hasWorkspaceAccessControlAccess } from '@/lib/billing'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  type PermissionGroupConfig,
  parsePermissionGroupConfig,
} from '@/lib/permission-groups/types'
import { checkWorkspaceAccess, hasWorkspaceAdminAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspacePermissionGroups')

const configSchema = z.object({
  allowedIntegrations: z.array(z.string()).nullable().optional(),
  allowedModelProviders: z.array(z.string()).nullable().optional(),
  hideTraceSpans: z.boolean().optional(),
  hideKnowledgeBaseTab: z.boolean().optional(),
  hideTablesTab: z.boolean().optional(),
  hideCopilot: z.boolean().optional(),
  hideIntegrationsTab: z.boolean().optional(),
  hideSecretsTab: z.boolean().optional(),
  hideApiKeysTab: z.boolean().optional(),
  hideInboxTab: z.boolean().optional(),
  hideFilesTab: z.boolean().optional(),
  disableMcpTools: z.boolean().optional(),
  disableCustomTools: z.boolean().optional(),
  disableSkills: z.boolean().optional(),
  disableInvitations: z.boolean().optional(),
  disablePublicApi: z.boolean().optional(),
  hideDeployApi: z.boolean().optional(),
  hideDeployMcp: z.boolean().optional(),
  hideDeployA2a: z.boolean().optional(),
  hideDeployChatbot: z.boolean().optional(),
  hideDeployTemplate: z.boolean().optional(),
})

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  config: configSchema.optional(),
  autoAddNewMembers: z.boolean().optional(),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { workspaceId } = await params

  const access = await checkWorkspaceAccess(workspaceId, session.user.id)
  if (!access.exists) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }
  if (!access.hasAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const groups = await db
    .select({
      id: permissionGroup.id,
      name: permissionGroup.name,
      description: permissionGroup.description,
      config: permissionGroup.config,
      createdBy: permissionGroup.createdBy,
      createdAt: permissionGroup.createdAt,
      updatedAt: permissionGroup.updatedAt,
      autoAddNewMembers: permissionGroup.autoAddNewMembers,
      creatorName: user.name,
      creatorEmail: user.email,
    })
    .from(permissionGroup)
    .leftJoin(user, eq(permissionGroup.createdBy, user.id))
    .where(eq(permissionGroup.workspaceId, workspaceId))
    .orderBy(desc(permissionGroup.createdAt))

  const groupsWithCounts = await Promise.all(
    groups.map(async (group) => {
      const [memberCount] = await db
        .select({ count: count() })
        .from(permissionGroupMember)
        .where(eq(permissionGroupMember.permissionGroupId, group.id))

      return {
        ...group,
        config: parsePermissionGroupConfig(group.config),
        memberCount: memberCount?.count ?? 0,
      }
    })
  )

  return NextResponse.json({ permissionGroups: groupsWithCounts })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { workspaceId } = await params

  try {
    const isWorkspaceAdmin = await hasWorkspaceAdminAccess(session.user.id, workspaceId)
    if (!isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Admin permissions required' }, { status: 403 })
    }

    const hasAccess = await hasWorkspaceAccessControlAccess(session.user.id, workspaceId)
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Access Control is an Enterprise feature' },
        { status: 403 }
      )
    }

    const body = await req.json()
    const { name, description, config, autoAddNewMembers } = createSchema.parse(body)

    const existingGroup = await db
      .select({ id: permissionGroup.id })
      .from(permissionGroup)
      .where(and(eq(permissionGroup.workspaceId, workspaceId), eq(permissionGroup.name, name)))
      .limit(1)

    if (existingGroup.length > 0) {
      return NextResponse.json(
        { error: 'A permission group with this name already exists' },
        { status: 409 }
      )
    }

    const groupConfig: PermissionGroupConfig = {
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      ...config,
    }

    const now = new Date()
    const newGroup = {
      id: generateId(),
      workspaceId,
      name,
      description: description || null,
      config: groupConfig,
      createdBy: session.user.id,
      createdAt: now,
      updatedAt: now,
      autoAddNewMembers: autoAddNewMembers || false,
    }

    await db.transaction(async (tx) => {
      if (autoAddNewMembers) {
        await tx
          .update(permissionGroup)
          .set({ autoAddNewMembers: false, updatedAt: now })
          .where(
            and(
              eq(permissionGroup.workspaceId, workspaceId),
              eq(permissionGroup.autoAddNewMembers, true)
            )
          )
      }
      await tx.insert(permissionGroup).values(newGroup)
    })

    logger.info('Created permission group', {
      permissionGroupId: newGroup.id,
      workspaceId,
      userId: session.user.id,
    })

    recordAudit({
      workspaceId,
      actorId: session.user.id,
      action: AuditAction.PERMISSION_GROUP_CREATED,
      resourceType: AuditResourceType.PERMISSION_GROUP,
      resourceId: newGroup.id,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      resourceName: name,
      description: `Created permission group "${name}"`,
      metadata: { workspaceId, autoAddNewMembers: autoAddNewMembers || false },
      request: req,
    })

    return NextResponse.json({ permissionGroup: newGroup }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    logger.error('Error creating permission group', error)
    return NextResponse.json({ error: 'Failed to create permission group' }, { status: 500 })
  }
}
