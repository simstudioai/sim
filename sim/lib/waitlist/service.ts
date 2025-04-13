import { and, count, desc, eq, like } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  getEmailSubject,
  renderWaitlistApprovalEmail,
  renderWaitlistConfirmationEmail,
} from '@/components/emails/render-email'
import { sendEmail } from '@/lib/mailer'
import { createToken, verifyToken } from '@/lib/waitlist/token'
import { db } from '@/db'
import { waitlist } from '@/db/schema'

// Define types for better type safety
export type WaitlistStatus = 'pending' | 'approved' | 'rejected' | 'signed_up'

export interface WaitlistEntry {
  id: string
  email: string
  status: WaitlistStatus
  createdAt: Date
  updatedAt: Date
}

// Helper function to find a user by email
async function findUserByEmail(email: string) {
  const normalizedEmail = email.toLowerCase().trim()
  const users = await db.select().from(waitlist).where(eq(waitlist.email, normalizedEmail)).limit(1)

  return {
    users,
    user: users.length > 0 ? users[0] : null,
    normalizedEmail,
  }
}

// Add a user to the waitlist
export async function addToWaitlist(email: string): Promise<{ success: boolean; message: string }> {
  try {
    const { users, normalizedEmail } = await findUserByEmail(email)

    if (users.length > 0) {
      return {
        success: false,
        message: 'Email already exists in waitlist',
      }
    }

    // Add to waitlist
    await db.insert(waitlist).values({
      id: nanoid(),
      email: normalizedEmail,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Send confirmation email
    try {
      const emailHtml = await renderWaitlistConfirmationEmail(normalizedEmail)
      const subject = getEmailSubject('waitlist-confirmation')

      await sendEmail({
        to: normalizedEmail,
        subject,
        html: emailHtml,
      })
    } catch (emailError) {
      console.error('Error sending confirmation email:', emailError)
      // Continue even if email fails - user is still on waitlist
    }

    return {
      success: true,
      message: 'Successfully added to waitlist',
    }
  } catch (error) {
    console.error('Error adding to waitlist:', error)
    return {
      success: false,
      message: 'An error occurred while adding to waitlist',
    }
  }
}

// Get all waitlist entries with pagination and search
export async function getWaitlistEntries(
  page = 1,
  limit = 20,
  status?: WaitlistStatus | 'all',
  search?: string
) {
  try {
    const offset = (page - 1) * limit

    // Build query conditions
    let whereCondition

    // First, determine if we need to apply status filter
    const shouldFilterByStatus = status && status !== 'all'

    console.log('Service: Filtering by status:', shouldFilterByStatus ? status : 'No status filter')

    // Now build the conditions
    if (shouldFilterByStatus && search && search.trim()) {
      // Both status and search
      console.log('Service: Applying status + search filter:', status)
      whereCondition = and(
        eq(waitlist.status, status as string),
        like(waitlist.email, `%${search.trim()}%`)
      )
    } else if (shouldFilterByStatus) {
      // Only status
      console.log('Service: Applying status filter only:', status)
      whereCondition = eq(waitlist.status, status as string)
    } else if (search && search.trim()) {
      // Only search
      console.log('Service: Applying search filter only')
      whereCondition = like(waitlist.email, `%${search.trim()}%`)
    } else {
      console.log('Service: No filters applied, showing all entries')
    }

    // Log what filter is being applied
    console.log('Service: Where condition:', whereCondition ? 'applied' : 'none')

    // Get entries with conditions
    let entries = []
    if (whereCondition) {
      entries = await db
        .select()
        .from(waitlist)
        .where(whereCondition)
        .limit(limit)
        .offset(offset)
        .orderBy(desc(waitlist.createdAt))
    } else {
      // Get all entries
      entries = await db
        .select()
        .from(waitlist)
        .limit(limit)
        .offset(offset)
        .orderBy(desc(waitlist.createdAt))
    }

    // Get total count for pagination with same conditions
    let countResult = []
    if (whereCondition) {
      countResult = await db.select({ value: count() }).from(waitlist).where(whereCondition)
    } else {
      countResult = await db.select({ value: count() }).from(waitlist)
    }

    console.log(
      `Service: Found ${entries.length} entries with ${status === 'all' ? 'all statuses' : `status=${status}`}, total: ${countResult[0]?.value || 0}`
    )

    return {
      entries,
      total: countResult[0]?.value || 0,
      page,
      limit,
    }
  } catch (error) {
    console.error('Error getting waitlist entries:', error)
    throw error
  }
}

// Approve a user from the waitlist and send approval email
export async function approveWaitlistUser(
  email: string
): Promise<{ success: boolean; message: string }> {
  try {
    const { user, normalizedEmail } = await findUserByEmail(email)

    if (!user) {
      return {
        success: false,
        message: 'User not found in waitlist',
      }
    }

    if (user.status === 'approved') {
      return {
        success: false,
        message: 'User already approved',
      }
    }

    // Update status to approved
    await db
      .update(waitlist)
      .set({
        status: 'approved',
        updatedAt: new Date(),
      })
      .where(eq(waitlist.email, normalizedEmail))

    // Create a special signup token
    const token = await createToken({
      email: normalizedEmail,
      type: 'waitlist-approval',
      expiresIn: '7d',
    })

    // Generate signup link with token
    const signupLink = `${process.env.NEXT_PUBLIC_APP_URL}/signup?token=${token}`

    // Send approval email
    try {
      const emailHtml = await renderWaitlistApprovalEmail(normalizedEmail, signupLink)
      const subject = getEmailSubject('waitlist-approval')

      await sendEmail({
        to: normalizedEmail,
        subject,
        html: emailHtml,
      })
    } catch (emailError) {
      console.error('Error sending approval email:', emailError)
      // Continue even if email fails - user is still approved in db
    }

    return {
      success: true,
      message: 'User approved and email sent',
    }
  } catch (error) {
    console.error('Error approving waitlist user:', error)
    return {
      success: false,
      message: 'An error occurred while approving user',
    }
  }
}

// Reject a user from the waitlist
export async function rejectWaitlistUser(
  email: string
): Promise<{ success: boolean; message: string }> {
  try {
    const { user, normalizedEmail } = await findUserByEmail(email)

    if (!user) {
      return {
        success: false,
        message: 'User not found in waitlist',
      }
    }

    // Update status to rejected
    await db
      .update(waitlist)
      .set({
        status: 'rejected',
        updatedAt: new Date(),
      })
      .where(eq(waitlist.email, normalizedEmail))

    return {
      success: true,
      message: 'User rejected',
    }
  } catch (error) {
    console.error('Error rejecting waitlist user:', error)
    return {
      success: false,
      message: 'An error occurred while rejecting user',
    }
  }
}

// Check if a user is approved
export async function isUserApproved(email: string): Promise<boolean> {
  try {
    const { user } = await findUserByEmail(email)
    return !!user && user.status === 'approved'
  } catch (error) {
    console.error('Error checking if user is approved:', error)
    return false
  }
}

// Verify waitlist token
export async function verifyWaitlistToken(
  token: string
): Promise<{ valid: boolean; email?: string }> {
  try {
    // Verify token
    const decoded = await verifyToken(token)

    if (!decoded || decoded.type !== 'waitlist-approval') {
      return { valid: false }
    }

    // Check if user is in the approved waitlist
    const isApproved = await isUserApproved(decoded.email)

    if (!isApproved) {
      return { valid: false }
    }

    return {
      valid: true,
      email: decoded.email,
    }
  } catch (error) {
    console.error('Error verifying waitlist token:', error)
    return { valid: false }
  }
}

// Mark a user as signed up after they create an account
export async function markWaitlistUserAsSignedUp(
  email: string
): Promise<{ success: boolean; message: string }> {
  try {
    const { user, normalizedEmail } = await findUserByEmail(email)

    if (!user) {
      return {
        success: false,
        message: 'User not found in waitlist',
      }
    }

    if (user.status !== 'approved') {
      return {
        success: false,
        message: 'User is not in approved status',
      }
    }

    // Update status to signed_up
    await db
      .update(waitlist)
      .set({
        status: 'signed_up',
        updatedAt: new Date(),
      })
      .where(eq(waitlist.email, normalizedEmail))

    return {
      success: true,
      message: 'User marked as signed up',
    }
  } catch (error) {
    console.error('Error marking waitlist user as signed up:', error)
    return {
      success: false,
      message: 'An error occurred while updating user status',
    }
  }
}
