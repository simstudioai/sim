import { db } from '@sim/db'
import { form } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { isDev } from '@/lib/core/config/feature-flags'
import { encryptSecret } from '@/lib/core/security/encryption'
import { getEmailDomain } from '@/lib/core/utils/urls'
import { deployWorkflow } from '@/lib/workflows/persistence/utils'
import {
  checkWorkflowAccessForFormCreation,
  DEFAULT_FORM_CUSTOMIZATIONS,
} from '@/app/api/form/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('FormAPI')

const fieldConfigSchema = z.object({
  name: z.string(),
  type: z.string(),
  label: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
})

const formSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  identifier: z
    .string()
    .min(1, 'Identifier is required')
    .max(100, 'Identifier must be 100 characters or less')
    .regex(/^[a-z0-9-]+$/, 'Identifier can only contain lowercase letters, numbers, and hyphens'),
  title: z.string().min(1, 'Title is required').max(200, 'Title must be 200 characters or less'),
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
  authType: z.enum(['public', 'password', 'email']).default('public'),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters')
    .optional()
    .or(z.literal('')),
  allowedEmails: z.array(z.string()).optional().default([]),
  showBranding: z.boolean().optional().default(true),
})

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    const deployments = await db.select().from(form).where(eq(form.userId, session.user.id))

    return createSuccessResponse({ deployments })
  } catch (error: any) {
    logger.error('Error fetching form deployments:', error)
    return createErrorResponse(error.message || 'Failed to fetch form deployments', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    const body = await request.json()

    try {
      const validatedData = formSchema.parse(body)

      const {
        workflowId,
        identifier,
        title,
        description = '',
        customizations,
        authType = 'public',
        password,
        allowedEmails = [],
        showBranding = true,
      } = validatedData

      if (authType === 'password' && !password) {
        return createErrorResponse('Password is required when using password protection', 400)
      }

      if (authType === 'email' && (!Array.isArray(allowedEmails) || allowedEmails.length === 0)) {
        return createErrorResponse(
          'At least one email or domain is required when using email access control',
          400
        )
      }

      const existingIdentifier = await db
        .select()
        .from(form)
        .where(eq(form.identifier, identifier))
        .limit(1)

      if (existingIdentifier.length > 0) {
        return createErrorResponse('Identifier already in use', 400)
      }

      const { hasAccess, workflow: workflowRecord } = await checkWorkflowAccessForFormCreation(
        workflowId,
        session.user.id
      )

      if (!hasAccess || !workflowRecord) {
        return createErrorResponse('Workflow not found or access denied', 404)
      }

      const result = await deployWorkflow({
        workflowId,
        deployedBy: session.user.id,
      })

      if (!result.success) {
        return createErrorResponse(result.error || 'Failed to deploy workflow', 500)
      }

      logger.info(
        `${workflowRecord.isDeployed ? 'Redeployed' : 'Auto-deployed'} workflow ${workflowId} for form (v${result.version})`
      )

      let encryptedPassword = null
      if (authType === 'password' && password) {
        const { encrypted } = await encryptSecret(password)
        encryptedPassword = encrypted
      }

      const id = uuidv4()

      logger.info('Creating form deployment with values:', {
        workflowId,
        identifier,
        title,
        authType,
        hasPassword: !!encryptedPassword,
        emailCount: allowedEmails?.length || 0,
        showBranding,
      })

      const mergedCustomizations = {
        ...DEFAULT_FORM_CUSTOMIZATIONS,
        ...(customizations || {}),
      }

      await db.insert(form).values({
        id,
        workflowId,
        userId: session.user.id,
        identifier,
        title,
        description: description || '',
        customizations: mergedCustomizations,
        isActive: true,
        authType,
        password: encryptedPassword,
        allowedEmails: authType === 'email' ? allowedEmails : [],
        showBranding,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const baseDomain = getEmailDomain()
      const protocol = isDev ? 'http' : 'https'
      const formUrl = `${protocol}://${baseDomain}/form/${identifier}`

      logger.info(`Form "${title}" deployed successfully at ${formUrl}`)

      return createSuccessResponse({
        id,
        formUrl,
        message: 'Form deployment created successfully',
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        const errorMessage = validationError.errors[0]?.message || 'Invalid request data'
        return createErrorResponse(errorMessage, 400, 'VALIDATION_ERROR')
      }
      throw validationError
    }
  } catch (error: any) {
    logger.error('Error creating form deployment:', error)
    return createErrorResponse(error.message || 'Failed to create form deployment', 500)
  }
}
