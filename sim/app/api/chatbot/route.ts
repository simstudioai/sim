import { NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console-logger'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { chatbotDeployment, workflow } from '@/db/schema'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { encryptSecret } from '@/lib/utils'

const logger = createLogger('ChatbotAPI')

// Define Zod schema for API request validation
const chatbotDeploymentSchema = z.object({
  workflowId: z.string().min(1, "Workflow ID is required"),
  subdomain: z.string().min(1, "Subdomain is required")
    .regex(/^[a-z0-9-]+$/, "Subdomain can only contain lowercase letters, numbers, and hyphens"),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  customizations: z.object({
    primaryColor: z.string(),
    welcomeMessage: z.string(),
  }),
  authType: z.enum(["public", "password", "email"]).default("public"),
  password: z.string().optional(),
  allowedEmails: z.array(z.string()).optional().default([]),
})

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    
    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }
    
    // Get the user's chatbot deployments
    const deployments = await db
      .select()
      .from(chatbotDeployment)
      .where(eq(chatbotDeployment.userId, session.user.id))
    
    return createSuccessResponse({ deployments })
  } catch (error: any) {
    logger.error('Error fetching chatbot deployments:', error)
    return createErrorResponse(error.message || 'Failed to fetch chatbot deployments', 500)
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
      const validatedData = chatbotDeploymentSchema.parse(body)
      
      // Extract validated data
      const { 
        workflowId, 
        subdomain, 
        title, 
        description = '', 
        customizations,
        authType = 'public',
        password,
        allowedEmails = []
      } = validatedData
      
      // Perform additional validation specific to auth types
      if (authType === 'password' && !password) {
        return createErrorResponse('Password is required when using password protection', 400)
      }
      
      if (authType === 'email' && (!Array.isArray(allowedEmails) || allowedEmails.length === 0)) {
        return createErrorResponse('At least one email or domain is required when using email access control', 400)
      }
      
      // Check if subdomain is available
      const existingSubdomain = await db
        .select()
        .from(chatbotDeployment)
        .where(eq(chatbotDeployment.subdomain, subdomain))
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
      
      // Verify the workflow is deployed (required for chatbot deployment)
      if (!workflowExists[0].isDeployed) {
        return createErrorResponse('Workflow must be deployed before creating a chatbot', 400)
      }
      
      // Encrypt password if provided
      let encryptedPassword = null
      if (authType === 'password' && password) {
        const { encrypted } = await encryptSecret(password)
        encryptedPassword = encrypted
      }
      
      // Create the chatbot deployment
      const id = uuidv4()
      await db.insert(chatbotDeployment).values({
        id,
        workflowId,
        userId: session.user.id,
        subdomain,
        title,
        description: description || '',
        customizations: customizations || {},
        isActive: true,
        authType,
        password: encryptedPassword,
        allowedEmails: authType === 'email' ? allowedEmails : [],
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      
      // Return successful response with chatbot URL
      const chatbotUrl = `https://${subdomain}.simstudio.ai`
      
      logger.info(`Chatbot "${title}" deployed successfully at ${chatbotUrl}`)

      return createSuccessResponse({
        id,
        chatbotUrl,
        message: 'Chatbot deployment created successfully' 
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        const errorMessage = validationError.errors[0]?.message || 'Invalid request data'
        return createErrorResponse(errorMessage, 400, 'VALIDATION_ERROR')
      }
      throw validationError
    }
  } catch (error: any) {
    logger.error('Error creating chatbot deployment:', error)
    return createErrorResponse(error.message || 'Failed to create chatbot deployment', 500)
  }
} 