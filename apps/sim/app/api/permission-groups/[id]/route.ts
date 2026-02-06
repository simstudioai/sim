import { db } from '@sim/db'
import { member, permissionGroup, permissionGroupMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { hasAccessControlAccess } from '@/lib/billing'
import {
  type PermissionGroupConfig,
  parsePermissionGroupConfig,
} from '@/lib/permission-groups/types'

const logger = createLogger('PermissionGroup')

const configSchema = z.object({
  allowedIntegrations: z.array(z.string()).nullable().optional(),
  allowedModelProviders: z.array(z.string()).nullable().optional(),
  hideTraceSpans: z.boolean().optional(),
  hideKnowledgeBaseTab: z.boolean().optional(),
  hideCopilot: z.boolean().optional(),
  hideApiKeysTab: z.boolean().optional(),
  hideEnvironmentTab: z.boolean().optional(),
  hideFilesTab: z.boolean().optional(),
  disableMcpTools: z.boolean().optional(),
  disableCustomTools: z.boolean().optional(),
  disableSkills: z.boolean().optional(),
  hideTemplates: z.boolean().optional(),
  disableInvitations: z.boolean().optional(),
  hideDeployApi: z.boolean().optional(),
  hideDeployMcp: z.boolean().optional(),
  hideDeployA2a: z.boolean().optional(),
  hideDeployChatbot: z.boolean().optional(),
  hideDeployTemplate: z.boolean().optional(),
})

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  config: configSchema.optional(),
  autoAddNewMembers: z.boolean().optional(),
})

async function getPermissionGroupWithAccess(groupId: string, userId: string) {
  const [group] = await db
    .select({
      id: permissionGroup.id,
      organizationId: permissionGroup.organizationId,
      name: permissionGroup.name,
      description: permissionGroup.description,
      config: permissionGroup.config,
      createdBy: permissionGroup.createdBy,
      createdAt: permissionGroup.createdAt,
      updatedAt: permissionGroup.updatedAt,
      autoAddNewMembers: permissionGroup.autoAddNewMembers,
    })
    .from(permissionGroup)
    .where(eq(permissionGroup.id, groupId))
    .limit(1)

  if (!group) return null

  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, group.organizationId)))
    .limit(1)

  if (!membership) return null

  return { group, role: membership.role }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const result = await getPermissionGroupWithAccess(id, session.user.id)

  if (!result) {
    return NextResponse.json({ error: 'Permission group not found' }, { status: 404 })
  }

  return NextResponse.json({
    permissionGroup: {
      ...result.group,
      config: parsePermissionGroupConfig(result.group.config),
    },
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const hasAccess = await hasAccessControlAccess(session.user.id)
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Access Control is an Enterprise feature' },
        { status: 403 }
      )
    }

    const result = await getPermissionGroupWithAccess(id, session.user.id)

    if (!result) {
      return NextResponse.json({ error: 'Permission group not found' }, { status: 404 })
    }

    if (result.role !== 'admin' && result.role !== 'owner') {
      return NextResponse.json({ error: 'Admin or owner permissions required' }, { status: 403 })
    }

    const body = await req.json()
    const updates = updateSchema.parse(body)

    if (updates.name) {
      const existingGroup = await db
        .select({ id: permissionGroup.id })
        .from(permissionGroup)
        .where(
          and(
            eq(permissionGroup.organizationId, result.group.organizationId),
            eq(permissionGroup.name, updates.name)
          )
        )
        .limit(1)

      if (existingGroup.length > 0 && existingGroup[0].id !== id) {
        return NextResponse.json(
          { error: 'A permission group with this name already exists' },
          { status: 409 }
        )
      }
    }

    const currentConfig = parsePermissionGroupConfig(result.group.config)
    const newConfig: PermissionGroupConfig = updates.config
      ? { ...currentConfig, ...updates.config }
      : currentConfig

    // If setting autoAddNewMembers to true, unset it on other groups in the org first
    if (updates.autoAddNewMembers === true) {
      await db
        .update(permissionGroup)
        .set({ autoAddNewMembers: false, updatedAt: new Date() })
        .where(
          and(
            eq(permissionGroup.organizationId, result.group.organizationId),
            eq(permissionGroup.autoAddNewMembers, true)
          )
        )
    }

    await db
      .update(permissionGroup)
      .set({
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.autoAddNewMembers !== undefined && {
          autoAddNewMembers: updates.autoAddNewMembers,
        }),
        config: newConfig,
        updatedAt: new Date(),
      })
      .where(eq(permissionGroup.id, id))

    const [updated] = await db
      .select()
      .from(permissionGroup)
      .where(eq(permissionGroup.id, id))
      .limit(1)

    return NextResponse.json({
      permissionGroup: {
        ...updated,
        config: parsePermissionGroupConfig(updated.config),
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    logger.error('Error updating permission group', error)
    return NextResponse.json({ error: 'Failed to update permission group' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const hasAccess = await hasAccessControlAccess(session.user.id)
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Access Control is an Enterprise feature' },
        { status: 403 }
      )
    }

    const result = await getPermissionGroupWithAccess(id, session.user.id)

    if (!result) {
      return NextResponse.json({ error: 'Permission group not found' }, { status: 404 })
    }

    if (result.role !== 'admin' && result.role !== 'owner') {
      return NextResponse.json({ error: 'Admin or owner permissions required' }, { status: 403 })
    }

    await db.delete(permissionGroupMember).where(eq(permissionGroupMember.permissionGroupId, id))
    await db.delete(permissionGroup).where(eq(permissionGroup.id, id))

    logger.info('Deleted permission group', { permissionGroupId: id, userId: session.user.id })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting permission group', error)
    return NextResponse.json({ error: 'Failed to delete permission group' }, { status: 500 })
  }
}
