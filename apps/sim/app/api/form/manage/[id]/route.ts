import { db } from '@sim/db'
import { form } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { encryptSecret } from '@/lib/core/security/encryption'
import { checkFormAccess, DEFAULT_FORM_CUSTOMIZATIONS } from '@/app/api/form/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('FormManageAPI')

const fieldConfigSchema = z.object({
  name: z.string(),
  type: z.string(),
  label: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
})

const updateFormSchema = z.object({
  identifier: z
    .string()
    .min(1, 'Identifier is required')
    .max(100, 'Identifier must be 100 characters or less')
    .regex(/^[a-z0-9-]+$/, 'Identifier can only contain lowercase letters, numbers, and hyphens')
    .optional(),
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title must be 200 characters or less')
    .optional(),
  description: z.string().max(1000, 'Description must be 1000 characters or less').optional(),
  customizations: z
    .object({
      primaryColor: z.string().optional(),
      welcomeMessage: z
        .string()
        .max(500, 'Welcome message must be 500 characters or less')
        .optional(),
      thankYouTitle: z
        .string()
        .max(100, 'Thank you title must be 100 characters or less')
        .optional(),
      thankYouMessage: z
        .string()
        .max(500, 'Thank you message must be 500 characters or less')
        .optional(),
      logoUrl: z.string().url('Logo URL must be a valid URL').optional().or(z.literal('')),
      fieldConfigs: z.array(fieldConfigSchema).optional(),
    })
    .optional(),
  authType: z.enum(['public', 'password', 'email']).optional(),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters')
    .optional()
    .or(z.literal('')),
  allowedEmails: z.array(z.string()).optional(),
  showBranding: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()

    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    const { id } = await params

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
  } catch (error: any) {
    logger.error('Error fetching form:', error)
    return createErrorResponse(error.message || 'Failed to fetch form', 500)
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()

    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    const { id } = await params

    const { hasAccess, form: formRecord } = await checkFormAccess(id, session.user.id)

    if (!hasAccess || !formRecord) {
      return createErrorResponse('Form not found or access denied', 404)
    }

    const body = await request.json()

    try {
      const validatedData = updateFormSchema.parse(body)

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
      } = validatedData

      if (identifier && identifier !== formRecord.identifier) {
        const existingIdentifier = await db
          .select()
          .from(form)
          .where(eq(form.identifier, identifier))
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

      const updateData: Record<string, any> = {
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
        const existingCustomizations = (formRecord.customizations as Record<string, any>) || {}
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

      return createSuccessResponse({
        message: 'Form updated successfully',
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        const errorMessage = validationError.errors[0]?.message || 'Invalid request data'
        return createErrorResponse(errorMessage, 400, 'VALIDATION_ERROR')
      }
      throw validationError
    }
  } catch (error: any) {
    logger.error('Error updating form:', error)
    return createErrorResponse(error.message || 'Failed to update form', 500)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()

    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    const { id } = await params

    const { hasAccess, form: formRecord } = await checkFormAccess(id, session.user.id)

    if (!hasAccess || !formRecord) {
      return createErrorResponse('Form not found or access denied', 404)
    }

    await db.update(form).set({ isActive: false, updatedAt: new Date() }).where(eq(form.id, id))

    logger.info(`Form ${id} deleted (soft delete)`)

    return createSuccessResponse({
      message: 'Form deleted successfully',
    })
  } catch (error: any) {
    logger.error('Error deleting form:', error)
    return createErrorResponse(error.message || 'Failed to delete form', 500)
  }
}
