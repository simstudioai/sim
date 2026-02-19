import { db } from '@sim/db'
import { form, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { NextRequest, NextResponse } from 'next/server'
import {
  isEmailAllowed,
  setDeploymentAuthCookie,
  validateAuthToken,
} from '@/lib/core/security/deployment'
import { decryptSecret } from '@/lib/core/security/encryption'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'

const logger = createLogger('FormAuthUtils')

export function setFormAuthCookie(
  response: NextResponse,
  formId: string,
  type: string,
  encryptedPassword?: string | null
): void {
  setDeploymentAuthCookie(response, 'form', formId, type, encryptedPassword)
}

/**
 * Check if user has permission to create a form for a specific workflow
 */
export async function checkWorkflowAccessForFormCreation(
  workflowId: string,
  userId: string
): Promise<{ hasAccess: boolean; workflow?: any }> {
  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId,
    userId,
    action: 'admin',
  })

  if (!authorization.workflow) {
    return { hasAccess: false }
  }

  if (authorization.allowed) {
    return { hasAccess: true, workflow: authorization.workflow }
  }

  return { hasAccess: false }
}

/**
 * Check if user has access to view/edit/delete a specific form
 */
export async function checkFormAccess(
  formId: string,
  userId: string
): Promise<{ hasAccess: boolean; form?: any; workspaceId?: string }> {
  const formData = await db
    .select({ form: form, workflowWorkspaceId: workflow.workspaceId })
    .from(form)
    .innerJoin(workflow, eq(form.workflowId, workflow.id))
    .where(eq(form.id, formId))
    .limit(1)

  if (formData.length === 0) {
    return { hasAccess: false }
  }

  const { form: formRecord, workflowWorkspaceId } = formData[0]
  if (!workflowWorkspaceId) {
    return { hasAccess: false }
  }

  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId: formRecord.workflowId,
    userId,
    action: 'admin',
  })

  return authorization.allowed
    ? { hasAccess: true, form: formRecord, workspaceId: workflowWorkspaceId }
    : { hasAccess: false }
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

      if (isEmailAllowed(email, allowedEmails)) {
        return { authorized: true }
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
 * Note: primaryColor is intentionally undefined to allow thank you screen to use its green default
 */
export const DEFAULT_FORM_CUSTOMIZATIONS: FormCustomizations = {
  welcomeMessage: '',
  thankYouTitle: 'Thank you!',
  thankYouMessage: 'Your response has been submitted successfully.',
}
