import { and, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { workspace, workspaceMember, workspaceInvitation, user } from '@/db/schema'

// GET /api/workspaces/invitations/accept - Accept an invitation via token
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  
  if (!token) {
    // Redirect to a page explaining the error
    return NextResponse.redirect(new URL('/invitation-error?reason=missing-token', process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'))
  }
  
  const session = await getSession()
  
  if (!session?.user?.id) {
    // Store the token in a query param and redirect to login page
    return NextResponse.redirect(new URL(`/auth/signin?callbackUrl=${encodeURIComponent(`/api/workspaces/invitations/accept?token=${token}`)}`, process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'))
  }
  
  try {
    // Find the invitation by token
    const invitation = await db
      .select()
      .from(workspaceInvitation)
      .where(eq(workspaceInvitation.token, token))
      .then(rows => rows[0])
    
    if (!invitation) {
      return NextResponse.redirect(new URL('/invitation-error?reason=invalid-token', process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'))
    }
    
    // Check if invitation has expired
    if (new Date() > new Date(invitation.expiresAt)) {
      return NextResponse.redirect(new URL('/invitation-error?reason=expired', process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'))
    }
    
    // Check if invitation is already accepted
    if (invitation.status !== 'pending') {
      return NextResponse.redirect(new URL('/invitation-error?reason=already-processed', process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'))
    }
    
    // Check if invitation email matches the logged-in user
    if (invitation.email.toLowerCase() !== session.user.email.toLowerCase()) {
      return NextResponse.redirect(new URL('/invitation-error?reason=email-mismatch', process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'))
    }
    
    // Get the workspace details
    const workspaceDetails = await db
      .select()
      .from(workspace)
      .where(eq(workspace.id, invitation.workspaceId))
      .then(rows => rows[0])
    
    if (!workspaceDetails) {
      return NextResponse.redirect(new URL('/invitation-error?reason=workspace-not-found', process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'))
    }
    
    // Check if user is already a member
    const existingMembership = await db
      .select()
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.workspaceId, invitation.workspaceId),
          eq(workspaceMember.userId, session.user.id)
        )
      )
      .then(rows => rows[0])
    
    if (existingMembership) {
      // User is already a member, just mark the invitation as accepted and redirect
      await db
        .update(workspaceInvitation)
        .set({
          status: 'accepted',
          updatedAt: new Date(),
        })
        .where(eq(workspaceInvitation.id, invitation.id))
      
      return NextResponse.redirect(new URL(`/w/${invitation.workspaceId}`, process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'))
    }
    
    // Add user to workspace
    await db
      .insert(workspaceMember)
      .values({
        id: randomUUID(),
        workspaceId: invitation.workspaceId,
        userId: session.user.id,
        role: invitation.role,
        joinedAt: new Date(),
        updatedAt: new Date(),
      })
    
    // Mark invitation as accepted
    await db
      .update(workspaceInvitation)
      .set({
        status: 'accepted',
        updatedAt: new Date(),
      })
      .where(eq(workspaceInvitation.id, invitation.id))
    
    // Redirect to the workspace
    return NextResponse.redirect(new URL(`/w/${invitation.workspaceId}`, process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'))
  } catch (error) {
    console.error('Error accepting invitation:', error)
    return NextResponse.redirect(new URL('/invitation-error?reason=server-error', process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'))
  }
} 