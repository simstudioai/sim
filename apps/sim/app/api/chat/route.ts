import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { isDev } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { encryptSecret } from '@/lib/utils'
import { deployWorkflow } from '@/lib/workflows/db-helpers'
import { checkWorkflowAccessForChatCreation } from '@/app/api/chat/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatAPI')

const chatSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  identifier: z
    .string()
    .min(1, 'Identifier is required')
    .regex(/^[a-z0-9-]+$/, 'Identifier can only contain lowercase letters, numbers, and hyphens'),
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  customizations: z.object({
    primaryColor: z.string(),
    welcomeMessage: z.string(),
    imageUrl: z.string().optional(),
  }),
  authType: z.enum(['public', 'password', 'email', 'sso']).default('public'),
  password: z.string().optional(),
  allowedEmails: z.array(z.string()).optional().default([]),
  outputConfigs: z
    .array(
      z.object({
        blockId: z.string(),
        path: z.string(),
      })
    )
    .optional()
    .default([]),
})

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    // Get the user's chat deployments
    const deployments = await db.select().from(chat).where(eq(chat.userId, session.user.id))

    return createSuccessResponse({ deployments })
  } catch (error: any) {
    logger.error('Error fetching chat deployments:', error)
    return createErrorResponse(error.message || 'Failed to fetch chat deployments', 500)
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
      const validatedData = chatSchema.parse(body)

      // Extract validated data
      const {
        workflowId,
        identifier,
        title,
        description = '',
        customizations,
        authType = 'public',
        password,
        allowedEmails = [],
        outputConfigs = [],
      } = validatedData

      // Perform additional validation specific to auth types
      if (authType === 'password' && !password) {
        return createErrorResponse('Password is required when using password protection', 400)
      }

      if (authType === 'email' && (!Array.isArray(allowedEmails) || allowedEmails.length === 0)) {
        return createErrorResponse(
          'At least one email or domain is required when using email access control',
          400
        )
      }

      if (authType === 'sso' && (!Array.isArray(allowedEmails) || allowedEmails.length === 0)) {
        return createErrorResponse(
          'At least one email or domain is required when using SSO access control',
          400
        )
      }

      // Check if identifier is available
      const existingIdentifier = await db
        .select()
        .from(chat)
        .where(eq(chat.identifier, identifier))
        .limit(1)

      if (existingIdentifier.length > 0) {
        return createErrorResponse('Identifier already in use', 400)
      }

      // Check if user has permission to create chat for this workflow
      const { hasAccess, workflow: workflowRecord } = await checkWorkflowAccessForChatCreation(
        workflowId,
        session.user.id
      )

      if (!hasAccess || !workflowRecord) {
        return createErrorResponse('Workflow not found or access denied', 404)
      }

      // Always deploy/redeploy the workflow to ensure latest version
      const result = await deployWorkflow({
        workflowId,
        deployedBy: session.user.id,
      })

      if (!result.success) {
        return createErrorResponse(result.error || 'Failed to deploy workflow', 500)
      }

      logger.info(
        `${workflowRecord.isDeployed ? 'Redeployed' : 'Auto-deployed'} workflow ${workflowId} for chat (v${result.version})`
      )

      // Encrypt password if provided
      let encryptedPassword = null
      if (authType === 'password' && password) {
        const { encrypted } = await encryptSecret(password)
        encryptedPassword = encrypted
      }

      // Create the chat deployment
      const id = uuidv4()

      // Log the values we're inserting
      logger.info('Creating chat deployment with values:', {
        workflowId,
        identifier,
        title,
        authType,
        hasPassword: !!encryptedPassword,
        emailCount: allowedEmails?.length || 0,
        outputConfigsCount: outputConfigs.length,
      })

      // Merge customizations with the additional fields
      const mergedCustomizations = {
        ...(customizations || {}),
        primaryColor: customizations?.primaryColor || 'var(--brand-primary-hover-hex)',
        welcomeMessage: customizations?.welcomeMessage || 'Hi there! How can I help you today?',
      }

      await db.insert(chat).values({
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
        allowedEmails: authType === 'email' || authType === 'sso' ? allowedEmails : [],
        outputConfigs,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Return successful response with chat URL
      // Generate chat URL using path-based routing instead of subdomains
      const baseUrl = getBaseUrl()

      let chatUrl: string
      try {
        const url = new URL(baseUrl)
        let host = url.host
        if (host.startsWith('www.')) {
          host = host.substring(4)
        }
        chatUrl = `${url.protocol}//${host}/chat/${identifier}`
      } catch (error) {
        logger.warn('Failed to parse baseUrl, falling back to defaults:', {
          baseUrl,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        // Fallback based on environment
        if (isDev) {
          chatUrl = `http://localhost:3000/chat/${identifier}`
        } else {
          chatUrl = `https://sim.ai/chat/${identifier}`
        }
      }

      logger.info(`Chat "${title}" deployed successfully at ${chatUrl}`)

      return createSuccessResponse({
        id,
        chatUrl,
        message: 'Chat deployment created successfully',
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        const errorMessage = validationError.errors[0]?.message || 'Invalid request data'
        return createErrorResponse(errorMessage, 400, 'VALIDATION_ERROR')
      }
      throw validationError
    }
  } catch (error: any) {
    logger.error('Error creating chat deployment:', error)
    return createErrorResponse(error.message || 'Failed to create chat deployment', 500)
  }
}
