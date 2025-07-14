import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { isDev } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'
import { encryptSecret } from '@/lib/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import { chat, workflow } from '@/db/schema'

const logger = createLogger('ChatAPI')

const chatSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  subdomain: z
    .string()
    .min(1, 'Subdomain is required')
    .regex(/^[a-z0-9-]+$/, 'Subdomain can only contain lowercase letters, numbers, and hyphens'),
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  customizations: z.object({
    primaryColor: z.string(),
    welcomeMessage: z.string(),
  }),
  authType: z.enum(['public', 'password', 'email']).default('public'),
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

    // Parse and validate request body
    const body = await request.json()

    try {
      const validatedData = chatSchema.parse(body)

      // Extract validated data
      const {
        workflowId,
        subdomain,
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

      // Check if subdomain is available
      const existingSubdomain = await db
        .select()
        .from(chat)
        .where(eq(chat.subdomain, subdomain))
        .limit(1)

      if (existingSubdomain.length > 0) {
        return createErrorResponse('Subdomain already in use', 400)
      }

      // Verify the workflow exists and belongs to the user
      const workflowExists = await db
        .select()
        .from(workflow)
        .where(and(eq(workflow.id, workflowId), eq(workflow.userId, session.user.id)))
        .limit(1)

      if (workflowExists.length === 0) {
        return createErrorResponse('Workflow not found or access denied', 404)
      }

      // Verify the workflow is deployed (required for chat deployment)
      if (!workflowExists[0].isDeployed) {
        return createErrorResponse('Workflow must be deployed before creating a chat', 400)
      }

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
        subdomain,
        title,
        authType,
        hasPassword: !!encryptedPassword,
        emailCount: allowedEmails?.length || 0,
        outputConfigsCount: outputConfigs.length,
      })

      // Merge customizations with the additional fields
      const mergedCustomizations = {
        ...(customizations || {}),
        primaryColor: customizations?.primaryColor || '#802FFF',
        welcomeMessage: customizations?.welcomeMessage || 'Hi there! How can I help you today?',
      }

      await db.insert(chat).values({
        id,
        workflowId,
        userId: session.user.id,
        subdomain,
        title,
        description: description || '',
        customizations: mergedCustomizations,
        isActive: true,
        authType,
        password: encryptedPassword,
        allowedEmails: authType === 'email' ? allowedEmails : [],
        outputConfigs,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Return successful response with chat URL
      // Check if we're in development or production
      const baseUrl = env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

      let chatUrl: string
      if (isDev) {
        try {
          const url = new URL(baseUrl)
          chatUrl = `${url.protocol}//${subdomain}.${url.host}`
        } catch (error) {
          logger.warn('Failed to parse baseUrl, falling back to localhost:', {
            baseUrl,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
          chatUrl = `http://${subdomain}.localhost:3000`
        }
      } else {
        chatUrl = `https://${subdomain}.simstudio.ai`
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
