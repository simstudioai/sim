import { db } from '@sim/db'
import { member, organization, permissionGroup, permissionGroupMember, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, desc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { hasAccessControlAccess } from '@/lib/billing'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  type PermissionGroupConfig,
  parsePermissionGroupConfig,
} from '@/lib/permission-groups/types'

const logger = createLogger('PermissionGroups')

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

const createSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  config: configSchema.optional(),
  autoAddNewMembers: z.boolean().optional(),
})

export async function GET(req: Request) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const organizationId = searchParams.get('organizationId')

  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
  }

  const membership = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
    .limit(1)

  if (membership.length === 0) {
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
    .where(eq(permissionGroup.organizationId, organizationId))
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

export async function POST(req: Request) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const hasAccess = await hasAccessControlAccess(session.user.id)
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Access Control is an Enterprise feature' },
        { status: 403 }
      )
    }

    const body = await req.json()
    const { organizationId, name, description, config, autoAddNewMembers } =
      createSchema.parse(body)

    const membership = await db
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
      .limit(1)

    const role = membership[0]?.role
    if (membership.length === 0 || (role !== 'admin' && role !== 'owner')) {
      return NextResponse.json({ error: 'Admin or owner permissions required' }, { status: 403 })
    }

    const orgExists = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (orgExists.length === 0) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const existingGroup = await db
      .select({ id: permissionGroup.id })
      .from(permissionGroup)
      .where(
        and(eq(permissionGroup.organizationId, organizationId), eq(permissionGroup.name, name))
      )
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

    // If autoAddNewMembers is true, unset it on any existing groups first
    if (autoAddNewMembers) {
      await db
        .update(permissionGroup)
        .set({ autoAddNewMembers: false, updatedAt: new Date() })
        .where(
          and(
            eq(permissionGroup.organizationId, organizationId),
            eq(permissionGroup.autoAddNewMembers, true)
          )
        )
    }

    const now = new Date()
    const newGroup = {
      id: crypto.randomUUID(),
      organizationId,
      name,
      description: description || null,
      config: groupConfig,
      createdBy: session.user.id,
      createdAt: now,
      updatedAt: now,
      autoAddNewMembers: autoAddNewMembers || false,
    }

    await db.insert(permissionGroup).values(newGroup)

    logger.info('Created permission group', {
      permissionGroupId: newGroup.id,
      organizationId,
      userId: session.user.id,
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
