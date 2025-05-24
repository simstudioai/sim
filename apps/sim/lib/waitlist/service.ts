import { and, count, desc, eq, inArray, like, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  getEmailSubject,
  renderWaitlistApprovalEmail,
  renderWaitlistConfirmationEmail,
} from '@/components/emails/render-email'
import { sendBatchEmails, sendEmail } from '@/lib/mailer'
import { createToken, verifyToken } from '@/lib/waitlist/token'
import { db } from '@/db'
import { waitlist } from '@/db/schema'
import { env } from '../env'

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

    // Now build the conditions
    if (shouldFilterByStatus && search && search.trim()) {
      // Both status and search
      whereCondition = and(
        eq(waitlist.status, status as string),
        like(waitlist.email, `%${search.trim()}%`)
      )
    } else if (shouldFilterByStatus) {
      // Only status
      whereCondition = eq(waitlist.status, status as string)
    } else if (search?.trim()) {
      // Only search
      whereCondition = like(waitlist.email, `%${search.trim()}%`)
    } else {
      whereCondition = null
    }

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
): Promise<{ success: boolean; message: string; emailError?: any; rateLimited?: boolean }> {
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

    // Create a special signup token
    const token = await createToken({
      email: normalizedEmail,
      type: 'waitlist-approval',
      expiresIn: '7d',
    })

    // Generate signup link with token
    const signupLink = `${env.NEXT_PUBLIC_APP_URL}/signup?token=${token}`

    // IMPORTANT: Send approval email BEFORE updating the status
    // This ensures we don't mark users as approved if email fails
    try {
      const emailHtml = await renderWaitlistApprovalEmail(normalizedEmail, signupLink)
      const subject = getEmailSubject('waitlist-approval')

      const emailResult = await sendEmail({
        to: normalizedEmail,
        subject,
        html: emailHtml,
      })

      // If email sending failed, don't update the user status
      if (!emailResult.success) {
        console.error('Error sending approval email:', emailResult.message)

        // Check if it's a rate limit error
        if (
          emailResult.message?.toLowerCase().includes('rate') ||
          emailResult.message?.toLowerCase().includes('too many') ||
          emailResult.message?.toLowerCase().includes('limit')
        ) {
          return {
            success: false,
            message: 'Rate limit exceeded for email sending',
            rateLimited: true,
          }
        }

        return {
          success: false,
          message: emailResult.message || 'Failed to send approval email',
          emailError: emailResult,
        }
      }

      // Email sent successfully, now update status to approved
      await db
        .update(waitlist)
        .set({
          status: 'approved',
          updatedAt: new Date(),
        })
        .where(eq(waitlist.email, normalizedEmail))

      return {
        success: true,
        message: 'User approved and email sent',
      }
    } catch (emailError) {
      console.error('Error sending approval email:', emailError)

      // Check if it's a rate limit error
      if (
        emailError instanceof Error &&
        (emailError.message.toLowerCase().includes('rate') ||
          emailError.message.toLowerCase().includes('too many') ||
          emailError.message.toLowerCase().includes('limit'))
      ) {
        return {
          success: false,
          message: 'Rate limit exceeded for email sending',
          rateLimited: true,
        }
      }

      return {
        success: false,
        message: 'Failed to send approval email',
        emailError,
      }
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

// Resend approval email to an already approved user
export async function resendApprovalEmail(
  email: string
): Promise<{ success: boolean; message: string; emailError?: any; rateLimited?: boolean }> {
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
        message: 'User is not approved',
      }
    }

    // Create a special signup token
    const token = await createToken({
      email: normalizedEmail,
      type: 'waitlist-approval',
      expiresIn: '7d',
    })

    // Generate signup link with token
    const signupLink = `${env.NEXT_PUBLIC_APP_URL}/signup?token=${token}`

    // Send approval email
    try {
      const emailHtml = await renderWaitlistApprovalEmail(normalizedEmail, signupLink)
      const subject = getEmailSubject('waitlist-approval')

      const emailResult = await sendEmail({
        to: normalizedEmail,
        subject,
        html: emailHtml,
      })

      // Check for email sending failures
      if (!emailResult.success) {
        console.error('Error sending approval email:', emailResult.message)

        // Check if it's a rate limit error
        if (
          emailResult.message?.toLowerCase().includes('rate') ||
          emailResult.message?.toLowerCase().includes('too many') ||
          emailResult.message?.toLowerCase().includes('limit')
        ) {
          return {
            success: false,
            message: 'Rate limit exceeded for email sending',
            rateLimited: true,
          }
        }

        return {
          success: false,
          message: emailResult.message || 'Failed to send approval email',
          emailError: emailResult,
        }
      }

      return {
        success: true,
        message: 'Approval email resent successfully',
      }
    } catch (emailError) {
      console.error('Error sending approval email:', emailError)

      // Check if it's a rate limit error
      if (
        emailError instanceof Error &&
        (emailError.message.toLowerCase().includes('rate') ||
          emailError.message.toLowerCase().includes('too many') ||
          emailError.message.toLowerCase().includes('limit'))
      ) {
        return {
          success: false,
          message: 'Rate limit exceeded for email sending',
          rateLimited: true,
        }
      }

      return {
        success: false,
        message: 'Failed to send approval email',
        emailError,
      }
    }
  } catch (error) {
    console.error('Error resending approval email:', error)
    return {
      success: false,
      message: 'An error occurred while resending approval email',
    }
  }
}

// Approve multiple users from the waitlist and send approval emails in batches
export async function approveBatchWaitlistUsers(emails: string[]): Promise<{
  success: boolean
  message: string
  results: Array<{ email: string; success: boolean; message: string }>
  emailErrors?: any
  rateLimited?: boolean
}> {
  try {
    if (!emails || emails.length === 0) {
      return {
        success: false,
        message: 'No emails provided for batch approval',
        results: [],
      }
    }

    // Fetch all users from the waitlist that match the emails
    const normalizedEmails = emails.map((email) => email.trim().toLowerCase())

    const users = await db
      .select()
      .from(waitlist)
      .where(
        and(
          inArray(waitlist.email, normalizedEmails),
          // Only select users who aren't already approved
          or(eq(waitlist.status, 'pending'), eq(waitlist.status, 'rejected'))
        )
      )

    if (users.length === 0) {
      return {
        success: false,
        message: 'No valid users found for approval',
        results: emails.map((email) => ({
          email,
          success: false,
          message: 'User not found or already approved',
        })),
      }
    }

    // Create email options for each user
    const emailOptions = await Promise.all(
      users.map(async (user) => {
        // Create a special signup token
        const token = await createToken({
          email: user.email,
          type: 'waitlist-approval',
          expiresIn: '7d',
        })

        // Generate signup link with token
        const signupLink = `${env.NEXT_PUBLIC_APP_URL}/signup?token=${token}`

        // Generate email HTML
        const emailHtml = await renderWaitlistApprovalEmail(user.email, signupLink)
        const subject = getEmailSubject('waitlist-approval')

        return {
          to: user.email,
          subject,
          html: emailHtml,
        }
      })
    )

    // Send batch emails
    const emailResults = await sendBatchEmails({ emails: emailOptions })

    // Process results and update database
    const results = users.map((user, index) => {
      const emailResult = emailResults.results[index]

      if (emailResult?.success) {
        // Update user status to approved in database
        return {
          email: user.email,
          success: true,
          message: 'User approved and email sent successfully',
          data: emailResult.data,
        }
      }
      return {
        email: user.email,
        success: false,
        message: emailResult?.message || 'Failed to send approval email',
        error: emailResult,
      }
    })

    // Update approved users in the database
    const successfulEmails = results
      .filter((result) => result.success)
      .map((result) => result.email)

    if (successfulEmails.length > 0) {
      await db
        .update(waitlist)
        .set({
          status: 'approved',
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(waitlist.email, successfulEmails),
            // Only update users who aren't already approved
            or(eq(waitlist.status, 'pending'), eq(waitlist.status, 'rejected'))
          )
        )
    }

    // Check if any rate limit errors occurred
    const rateLimitError = emailResults.results.some(
      (result: { message?: string }) =>
        result.message?.toLowerCase().includes('rate') ||
        result.message?.toLowerCase().includes('too many') ||
        result.message?.toLowerCase().includes('limit')
    )

    return {
      success: successfulEmails.length > 0,
      message:
        successfulEmails.length === users.length
          ? 'All users approved successfully'
          : successfulEmails.length > 0
            ? 'Some users approved successfully'
            : 'Failed to approve any users',
      results: results.map(
        ({ email, success, message }: { email: string; success: boolean; message: string }) => ({
          email,
          success,
          message,
        })
      ),
      emailErrors: emailResults.results.some((r: { success: boolean }) => !r.success),
      rateLimited: rateLimitError,
    }
  } catch (error) {
    console.error('Error approving batch waitlist users:', error)
    return {
      success: false,
      message: 'An error occurred while approving users',
      results: emails.map((email) => ({
        email,
        success: false,
        message: 'Operation failed due to server error',
      })),
    }
  }
}
