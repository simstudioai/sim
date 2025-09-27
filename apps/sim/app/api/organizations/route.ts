import { db } from '@sim/db'
import { member } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createOrganizationForTeamPlan } from '@/lib/billing/organization'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CreateTeamOrganization')

export async function POST(request: Request) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized - no active session' }, { status: 401 })
    }

    const user = session.user

    // Parse request body for optional name and slug
    let organizationName = user.name
    let organizationSlug: string | undefined

    try {
      const body = await request.json()
      if (body.name && typeof body.name === 'string') {
        organizationName = body.name
      }
      if (body.slug && typeof body.slug === 'string') {
        organizationSlug = body.slug
      }
    } catch {
      // If no body or invalid JSON, use defaults
    }

    logger.info('Creating organization for team plan', {
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      organizationName,
      organizationSlug,
    })

    // Enforce: a user can only belong to one organization at a time
    const existingOrgMembership = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, user.id))
      .limit(1)

    if (existingOrgMembership.length > 0) {
      return NextResponse.json(
        {
          error:
            'You are already a member of an organization. Leave your current organization before creating a new one.',
        },
        { status: 409 }
      )
    }

    // Create organization and make user the owner/admin
    const organizationId = await createOrganizationForTeamPlan(
      user.id,
      organizationName || undefined,
      user.email,
      organizationSlug
    )

    logger.info('Successfully created organization for team plan', {
      userId: user.id,
      organizationId,
    })

    return NextResponse.json({
      success: true,
      organizationId,
    })
  } catch (error) {
    logger.error('Failed to create organization for team plan', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      {
        error: 'Failed to create organization',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
