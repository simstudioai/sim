import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { form } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { formIdParamsSchema, updateFormContract } from '@/lib/api/contracts/forms'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { encryptSecret } from '@/lib/core/security/encryption'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkFormAccess, DEFAULT_FORM_CUSTOMIZATIONS } from '@/app/api/form/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('FormManageAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()

      if (!session) {
        return createErrorResponse('Unauthorized', 401)
      }

      const { id } = formIdParamsSchema.parse(await params)

      const { hasAccess, form: formRecord } = await checkFormAccess(id, session.user.id)

      if (!hasAccess || !formRecord) {
        return createErrorResponse('Form not found or access denied', 404)
      }

      const { password: _password, ...formWithoutPassword } = formRecord

      return createSuccessResponse({
        form: {
          ...formWithoutPassword,
          hasPassword: !!formRecord.password,
        },
      })
    } catch (error) {
      logger.error('Error fetching form:', error)
      return createErrorResponse(getErrorMessage(error, 'Failed to fetch form'), 500)
    }
  }
)

export const PATCH = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()

      if (!session) {
        return createErrorResponse('Unauthorized', 401)
      }

      const parsed = await parseRequest(updateFormContract, request, context, {
        validationErrorResponse: (error) =>
          createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params
      const {
        identifier,
        title,
        description,
        customizations,
        authType,
        password,
        allowedEmails,
        showBranding,
        isActive,
      } = parsed.data.body

      const {
        hasAccess,
        form: formRecord,
        workspaceId: formWorkspaceId,
      } = await checkFormAccess(id, session.user.id)

      if (!hasAccess || !formRecord) {
        return createErrorResponse('Form not found or access denied', 404)
      }

      if (identifier && identifier !== formRecord.identifier) {
        const existingIdentifier = await db
          .select()
          .from(form)
          .where(and(eq(form.identifier, identifier), isNull(form.archivedAt)))
          .limit(1)

        if (existingIdentifier.length > 0) {
          return createErrorResponse('Identifier already in use', 400)
        }
      }

      if (authType === 'password' && !password && !formRecord.password) {
        return createErrorResponse('Password is required when using password protection', 400)
      }

      if (
        authType === 'email' &&
        (!allowedEmails || allowedEmails.length === 0) &&
        (!formRecord.allowedEmails || (formRecord.allowedEmails as string[]).length === 0)
      ) {
        return createErrorResponse(
          'At least one email or domain is required when using email access control',
          400
        )
      }

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      }

      if (identifier !== undefined) updateData.identifier = identifier
      if (title !== undefined) updateData.title = title
      if (description !== undefined) updateData.description = description
      if (showBranding !== undefined) updateData.showBranding = showBranding
      if (isActive !== undefined) updateData.isActive = isActive
      if (authType !== undefined) updateData.authType = authType
      if (allowedEmails !== undefined) updateData.allowedEmails = allowedEmails

      if (customizations !== undefined) {
        const existingCustomizations = (formRecord.customizations as Record<string, unknown>) || {}
        updateData.customizations = {
          ...DEFAULT_FORM_CUSTOMIZATIONS,
          ...existingCustomizations,
          ...customizations,
        }
      }

      if (password) {
        const { encrypted } = await encryptSecret(password)
        updateData.password = encrypted
      } else if (authType && authType !== 'password') {
        updateData.password = null
      }

      await db.update(form).set(updateData).where(eq(form.id, id))

      logger.info(`Form ${id} updated successfully`)

      recordAudit({
        workspaceId: formWorkspaceId ?? null,
        actorId: session.user.id,
        action: AuditAction.FORM_UPDATED,
        resourceType: AuditResourceType.FORM,
        resourceId: id,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        resourceName: (title || formRecord.title) ?? undefined,
        description: `Updated form "${title || formRecord.title}"`,
        metadata: {
          identifier: identifier || formRecord.identifier,
          workflowId: formRecord.workflowId,
          authType: authType || formRecord.authType,
          updatedFields: Object.keys(updateData).filter((k) => k !== 'updatedAt'),
        },
        request,
      })

      return createSuccessResponse({
        message: 'Form updated successfully',
      })
    } catch (error) {
      logger.error('Error updating form:', error)
      return createErrorResponse(getErrorMessage(error, 'Failed to update form'), 500)
    }
  }
)

export const DELETE = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()

      if (!session) {
        return createErrorResponse('Unauthorized', 401)
      }

      const { id } = formIdParamsSchema.parse(await params)

      const {
        hasAccess,
        form: formRecord,
        workspaceId: formWorkspaceId,
      } = await checkFormAccess(id, session.user.id)

      if (!hasAccess || !formRecord) {
        return createErrorResponse('Form not found or access denied', 404)
      }

      await db
        .update(form)
        .set({ archivedAt: new Date(), isActive: false, updatedAt: new Date() })
        .where(eq(form.id, id))

      logger.info(`Form ${id} soft deleted`)

      recordAudit({
        workspaceId: formWorkspaceId ?? null,
        actorId: session.user.id,
        action: AuditAction.FORM_DELETED,
        resourceType: AuditResourceType.FORM,
        resourceId: id,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        resourceName: formRecord.title ?? undefined,
        description: `Deleted form "${formRecord.title}"`,
        metadata: { identifier: formRecord.identifier, workflowId: formRecord.workflowId },
        request,
      })

      return createSuccessResponse({
        message: 'Form deleted successfully',
      })
    } catch (error) {
      logger.error('Error deleting form:', error)
      return createErrorResponse(getErrorMessage(error, 'Failed to delete form'), 500)
    }
  }
)
