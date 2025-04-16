import { NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { chatbotDeployment } from '@/db/schema'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { z } from 'zod'
import { encryptSecret } from '@/lib/utils'

const logger = createLogger('ChatbotDetailAPI')

// Schema for updating an existing chatbot
const chatbotUpdateSchema = z.object({
  workflowId: z.string().min(1, "Workflow ID is required").optional(),
  subdomain: z.string().min(1, "Subdomain is required")
    .regex(/^[a-z0-9-]+$/, "Subdomain can only contain lowercase letters, numbers, and hyphens")
    .optional(),
  title: z.string().min(1, "Title is required").optional(),
  description: z.string().optional(),
  customizations: z.object({
    primaryColor: z.string(),
    welcomeMessage: z.string(),
  }).optional(),
  authType: z.enum(["public", "password", "email"]).optional(),
  password: z.string().optional(),
  allowedEmails: z.array(z.string()).optional(),
})

/**
 * GET endpoint to fetch a specific chatbot deployment by ID
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const chatbotId = id
  
  try {
    const session = await getSession()
    
    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }
    
    // Get the specific chatbot deployment
    const chatbot = await db
      .select()
      .from(chatbotDeployment)
      .where(and(
        eq(chatbotDeployment.id, chatbotId),
        eq(chatbotDeployment.userId, session.user.id)
      ))
      .limit(1)
    
    if (chatbot.length === 0) {
      return createErrorResponse('Chatbot not found or access denied', 404)
    }
    
    // Create a new result object without the password
    const { password, ...safeData } = chatbot[0]
    
    // For security, don't return the actual password value
    const result = {
      ...safeData,
      chatbotUrl: `https://${chatbot[0].subdomain}.simstudio.ai`,
      // Include password presence flag but not the actual value
      hasPassword: !!password
    }
    
    return createSuccessResponse(result)
  } catch (error: any) {
    logger.error('Error fetching chatbot deployment:', error)
    return createErrorResponse(error.message || 'Failed to fetch chatbot deployment', 500)
  }
}

/**
 * PATCH endpoint to update an existing chatbot deployment
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const chatbotId = id
  
  try {
    const session = await getSession()
    
    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }
    
    const body = await request.json()
    
    try {
      const validatedData = chatbotUpdateSchema.parse(body)
      
      // Verify the chatbot exists and belongs to the user
      const existingChatbot = await db
        .select()
        .from(chatbotDeployment)
        .where(and(
          eq(chatbotDeployment.id, chatbotId),
          eq(chatbotDeployment.userId, session.user.id)
        ))
        .limit(1)
      
      if (existingChatbot.length === 0) {
        return createErrorResponse('Chatbot not found or access denied', 404)
      }
      
      // Extract validated data
      const { 
        workflowId, 
        subdomain, 
        title, 
        description, 
        customizations,
        authType,
        password,
        allowedEmails
      } = validatedData
      
      // Check if subdomain is changing and if it's available
      if (subdomain && subdomain !== existingChatbot[0].subdomain) {
        const existingSubdomain = await db
          .select()
          .from(chatbotDeployment)
          .where(eq(chatbotDeployment.subdomain, subdomain))
          .limit(1)
        
        if (existingSubdomain.length > 0 && existingSubdomain[0].id !== chatbotId) {
          return createErrorResponse('Subdomain already in use', 400)
        }
      }
      
      // Encrypt password if provided and changing auth type
      let encryptedPassword = undefined
      if (authType === 'password' && password) {
        const { encrypted } = await encryptSecret(password)
        encryptedPassword = encrypted
      }
      
      // Prepare update data
      const updateData: any = {
        updatedAt: new Date(),
      }
      
      // Only include fields that are provided
      if (workflowId) updateData.workflowId = workflowId
      if (subdomain) updateData.subdomain = subdomain
      if (title) updateData.title = title
      if (description !== undefined) updateData.description = description
      if (customizations) updateData.customizations = customizations
      if (authType) updateData.authType = authType
      if (encryptedPassword) updateData.password = encryptedPassword
      if (allowedEmails) updateData.allowedEmails = allowedEmails
      
      // Update the chatbot deployment
      await db
        .update(chatbotDeployment)
        .set(updateData)
        .where(eq(chatbotDeployment.id, chatbotId))
      
      // Return success response
      const updatedSubdomain = subdomain || existingChatbot[0].subdomain
      const chatbotUrl = `https://${updatedSubdomain}.simstudio.ai`
      
      logger.info(`Chatbot "${chatbotId}" updated successfully`)
      
      return createSuccessResponse({
        id: chatbotId,
        chatbotUrl,
        message: 'Chatbot deployment updated successfully'
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        const errorMessage = validationError.errors[0]?.message || 'Invalid request data'
        return createErrorResponse(errorMessage, 400, 'VALIDATION_ERROR')
      }
      throw validationError
    }
  } catch (error: any) {
    logger.error('Error updating chatbot deployment:', error)
    return createErrorResponse(error.message || 'Failed to update chatbot deployment', 500)
  }
}

/**
 * DELETE endpoint to remove a chatbot deployment
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const chatbotId = params.id
  
  try {
    const session = await getSession()
    
    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }
    
    // Verify the chatbot exists and belongs to the user
    const existingChatbot = await db
      .select()
      .from(chatbotDeployment)
      .where(and(
        eq(chatbotDeployment.id, chatbotId),
        eq(chatbotDeployment.userId, session.user.id)
      ))
      .limit(1)
    
    if (existingChatbot.length === 0) {
      return createErrorResponse('Chatbot not found or access denied', 404)
    }
    
    // Delete the chatbot deployment
    await db
      .delete(chatbotDeployment)
      .where(eq(chatbotDeployment.id, chatbotId))
    
    logger.info(`Chatbot "${chatbotId}" deleted successfully`)
    
    return createSuccessResponse({
      message: 'Chatbot deployment deleted successfully'
    })
  } catch (error: any) {
    logger.error('Error deleting chatbot deployment:', error)
    return createErrorResponse(error.message || 'Failed to delete chatbot deployment', 500)
  }
} 