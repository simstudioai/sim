import { db } from '@sim/db'
import { environment, workspaceEnvironment } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import {
  syncPersonalEnvCredentialsForUser,
  syncWorkspaceEnvCredentials,
} from '@/lib/credentials/environment'
import { syncWorkspaceOAuthCredentialsForUser } from '@/lib/credentials/oauth'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CredentialsBootstrapAPI')

const bootstrapSchema = z.object({
  workspaceId: z.string().uuid('Workspace ID must be a valid UUID'),
})

/**
 * Ensures the current user's connected accounts and env vars are reflected as workspace credentials.
 */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const parseResult = bootstrapSchema.safeParse(await request.json())
    if (!parseResult.success) {
      return NextResponse.json({ error: parseResult.error.errors[0]?.message }, { status: 400 })
    }

    const { workspaceId } = parseResult.data
    const workspaceAccess = await checkWorkspaceAccess(workspaceId, session.user.id)
    if (!workspaceAccess.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [personalRow, workspaceRow] = await Promise.all([
      db
        .select({ variables: environment.variables })
        .from(environment)
        .where(eq(environment.userId, session.user.id))
        .limit(1),
      db
        .select({ variables: workspaceEnvironment.variables })
        .from(workspaceEnvironment)
        .where(eq(workspaceEnvironment.workspaceId, workspaceId))
        .limit(1),
    ])

    const personalKeys = Object.keys((personalRow[0]?.variables as Record<string, string>) || {})
    const workspaceKeys = Object.keys((workspaceRow[0]?.variables as Record<string, string>) || {})

    const [oauthSyncResult] = await Promise.all([
      syncWorkspaceOAuthCredentialsForUser({ workspaceId, userId: session.user.id }),
      syncPersonalEnvCredentialsForUser({ userId: session.user.id, envKeys: personalKeys }),
      syncWorkspaceEnvCredentials({
        workspaceId,
        envKeys: workspaceKeys,
        actingUserId: session.user.id,
      }),
    ])

    return NextResponse.json({
      success: true,
      synced: {
        oauthCreated: oauthSyncResult.createdCredentials,
        oauthMembershipsUpdated: oauthSyncResult.updatedMemberships,
        personalEnvKeys: personalKeys.length,
        workspaceEnvKeys: workspaceKeys.length,
      },
    })
  } catch (error) {
    logger.error('Failed to bootstrap workspace credentials', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
