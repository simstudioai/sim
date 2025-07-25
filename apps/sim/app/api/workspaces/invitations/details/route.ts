import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { workspace, workspaceInvitation } from '@/db/schema'

export const dynamic = 'force-dynamic'

// Get invitation details by token
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 })
  }

  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Find the invitation by token
    const invitation = await db
      .select()
      .from(workspaceInvitation)
      .where(eq(workspaceInvitation.token, token))
      .then((rows) => rows[0])

    if (!invitation) {
      return NextResponse.json({ error: 'Invitation not found or has expired' }, { status: 404 })
    }

    // Check if invitation has expired
    if (new Date() > new Date(invitation.expiresAt)) {
      return NextResponse.json({ error: 'Invitation has expired' }, { status: 400 })
    }

    // Get workspace details
    const workspaceDetails = await db
      .select()
      .from(workspace)
      .where(eq(workspace.id, invitation.workspaceId))
      .then((rows) => rows[0])

    if (!workspaceDetails) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Return the invitation with workspace name
    return NextResponse.json({
      ...invitation,
      workspaceName: workspaceDetails.name,
    })
  } catch (error) {
    console.error('Error fetching workspace invitation:', error)
    return NextResponse.json({ error: 'Failed to fetch invitation details' }, { status: 500 })
  }
}
