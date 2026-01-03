import { createHash } from 'crypto'
import { db } from '@sim/db'
import { form, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { NextRequest, NextResponse } from 'next/server'
import { isDev } from '@/lib/core/config/feature-flags'
import { decryptSecret } from '@/lib/core/security/encryption'
import { hasAdminPermission } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('FormAuthUtils')

function hashPassword(encryptedPassword: string): string {
  return createHash('sha256').update(encryptedPassword).digest('hex').substring(0, 8)
}

/**
 * Check if user has permission to create a form for a specific workflow
 * Either the user owns the workflow directly OR has admin permission for the workflow's workspace
 */
export async function checkWorkflowAccessForFormCreation(
  workflowId: string,
  userId: string
): Promise<{ hasAccess: boolean; workflow?: any }> {
  const workflowData = await db.select().from(workflow).where(eq(workflow.id, workflowId)).limit(1)

  if (workflowData.length === 0) {
    return { hasAccess: false }
  }

  const workflowRecord = workflowData[0]

  if (workflowRecord.userId === userId) {
    return { hasAccess: true, workflow: workflowRecord }
  }

  if (workflowRecord.workspaceId) {
    const hasAdmin = await hasAdminPermission(userId, workflowRecord.workspaceId)
    if (hasAdmin) {
      return { hasAccess: true, workflow: workflowRecord }
    }
  }

  return { hasAccess: false }
}

/**
 * Check if user has access to view/edit/delete a specific form
 * Either the user owns the form directly OR has admin permission for the workflow's workspace
 */
export async function checkFormAccess(
  formId: string,
  userId: string
): Promise<{ hasAccess: boolean; form?: any }> {
  const formData = await db
    .select({
      form: form,
      workflowWorkspaceId: workflow.workspaceId,
    })
    .from(form)
    .innerJoin(workflow, eq(form.workflowId, workflow.id))
    .where(eq(form.id, formId))
    .limit(1)

  if (formData.length === 0) {
    return { hasAccess: false }
  }

  const { form: formRecord, workflowWorkspaceId } = formData[0]

  if (formRecord.userId === userId) {
    return { hasAccess: true, form: formRecord }
  }

  if (workflowWorkspaceId) {
    const hasAdmin = await hasAdminPermission(userId, workflowWorkspaceId)
    if (hasAdmin) {
      return { hasAccess: true, form: formRecord }
    }
  }

  return { hasAccess: false }
}

function encryptAuthToken(formId: string, type: string, encryptedPassword?: string | null): string {
  const pwHash = encryptedPassword ? hashPassword(encryptedPassword) : ''
  return Buffer.from(`${formId}:${type}:${Date.now()}:${pwHash}`).toString('base64')
}

export function validateAuthToken(
  token: string,
  formId: string,
  encryptedPassword?: string | null
): boolean {
  try {
    const decoded = Buffer.from(token, 'base64').toString()
    const parts = decoded.split(':')
    const [storedId, _type, timestamp, storedPwHash] = parts

    if (storedId !== formId) {
      return false
    }

    const createdAt = Number.parseInt(timestamp)
    const now = Date.now()
    const expireTime = 24 * 60 * 60 * 1000

    if (now - createdAt > expireTime) {
      return false
    }

    if (encryptedPassword) {
      const currentPwHash = hashPassword(encryptedPassword)
      if (storedPwHash !== currentPwHash) {
        return false
      }
    }

    return true
  } catch (_e) {
    return false
  }
}

export function setFormAuthCookie(
  response: NextResponse,
  formId: string,
  type: string,
  encryptedPassword?: string | null
): void {
  const token = encryptAuthToken(formId, type, encryptedPassword)
  response.cookies.set({
    name: `form_auth_${formId}`,
    value: token,
    httpOnly: true,
    secure: !isDev,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24,
  })
}

export function addCorsHeaders(response: NextResponse, request: NextRequest) {
  const origin = request.headers.get('origin') || ''

  // Forms are public-facing and can be embedded anywhere
  // Allow CORS from any origin for form submissions
  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With')
  }

  return response
}

export async function validateFormAuth(
  requestId: string,
  deployment: any,
  request: NextRequest,
  parsedBody?: any
): Promise<{ authorized: boolean; error?: string }> {
  const authType = deployment.authType || 'public'

  if (authType === 'public') {
    return { authorized: true }
  }

  const cookieName = `form_auth_${deployment.id}`
  const authCookie = request.cookies.get(cookieName)

  if (authCookie && validateAuthToken(authCookie.value, deployment.id, deployment.password)) {
    return { authorized: true }
  }

  if (authType === 'password') {
    if (request.method === 'GET') {
      return { authorized: false, error: 'auth_required_password' }
    }

    try {
      if (!parsedBody) {
        return { authorized: false, error: 'Password is required' }
      }

      const { password, formData } = parsedBody

      if (formData && !password) {
        return { authorized: false, error: 'auth_required_password' }
      }

      if (!password) {
        return { authorized: false, error: 'Password is required' }
      }

      if (!deployment.password) {
        logger.error(`[${requestId}] No password set for password-protected form: ${deployment.id}`)
        return { authorized: false, error: 'Authentication configuration error' }
      }

      const { decrypted } = await decryptSecret(deployment.password)
      if (password !== decrypted) {
        return { authorized: false, error: 'Invalid password' }
      }

      return { authorized: true }
    } catch (error) {
      logger.error(`[${requestId}] Error validating password:`, error)
      return { authorized: false, error: 'Authentication error' }
    }
  }

  if (authType === 'email') {
    if (request.method === 'GET') {
      return { authorized: false, error: 'auth_required_email' }
    }

    try {
      if (!parsedBody) {
        return { authorized: false, error: 'Email is required' }
      }

      const { email, formData } = parsedBody

      if (formData && !email) {
        return { authorized: false, error: 'auth_required_email' }
      }

      if (!email) {
        return { authorized: false, error: 'Email is required' }
      }

      const allowedEmails: string[] = deployment.allowedEmails || []

      // Check if exact email is in the allowed list
      if (allowedEmails.includes(email)) {
        return { authorized: true }
      }

      // Check if email domain is allowed (e.g., @example.com)
      const atIndex = email.indexOf('@')
      if (atIndex > 0) {
        const domain = email.substring(atIndex + 1)
        if (domain && allowedEmails.some((allowed: string) => allowed === `@${domain}`)) {
          return { authorized: true }
        }
      }

      return { authorized: false, error: 'Email not authorized for this form' }
    } catch (error) {
      logger.error(`[${requestId}] Error validating email:`, error)
      return { authorized: false, error: 'Authentication error' }
    }
  }

  return { authorized: false, error: 'Unsupported authentication type' }
}

/**
 * Form customizations interface
 */
export interface FormCustomizations {
  primaryColor?: string
  welcomeMessage?: string
  thankYouTitle?: string
  thankYouMessage?: string
  logoUrl?: string
}

/**
 * Default form customizations
 */
export const DEFAULT_FORM_CUSTOMIZATIONS: FormCustomizations = {
  primaryColor: '#3972F6',
  welcomeMessage: '',
  thankYouTitle: 'Thank you!',
  thankYouMessage: 'Your response has been submitted successfully.',
}
