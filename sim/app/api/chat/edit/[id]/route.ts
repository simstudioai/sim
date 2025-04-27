import { NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { chatDeployment } from '@/db/schema'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { z } from 'zod'
import { encryptSecret } from '@/lib/utils'

const logger = createLogger('ChatDetailAPI')

// Schema for updating an existing chat
const chatUpdateSchema = z.object({
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
 * GET endpoint to fetch a specific chat deployment by ID
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const chatId = id
  
  try {
    const session = await getSession()
    
    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }
    
    // Get the specific chat deployment
    const chat = await db
      .select()
      .from(chatDeployment)
      .where(and(
        eq(chatDeployment.id, chatId),
        eq(chatDeployment.userId, session.user.id)
      ))
      .limit(1)
    
    if (chat.length === 0) {
      return createErrorResponse('Chat not found or access denied', 404)
    }
    
    // Create a new result object without the password
    const { password, ...safeData } = chat[0]
    
    // Check if we're in development or production
    const isDevelopment = process.env.NODE_ENV === 'development'
    const chatUrl = isDevelopment
      ? `http://${chat[0].subdomain}.localhost:3000`
      : `https://${chat[0].subdomain}.simstudio.ai`
    
    // For security, don't return the actual password value
    const result = {
      ...safeData,
      chatUrl,
      // Include password presence flag but not the actual value
      hasPassword: !!password
    }
    
    return createSuccessResponse(result)
  } catch (error: any) {
    logger.error('Error fetching chat deployment:', error)
    return createErrorResponse(error.message || 'Failed to fetch chat deployment', 500)
  }
}

/**
 * PATCH endpoint to update an existing chat deployment
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const chatId = id
  
  try {
    const session = await getSession()
    
    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }
    
    const body = await request.json()
    
    try {
      const validatedData = chatUpdateSchema.parse(body)
      
      // Verify the chat exists and belongs to the user
      const existingChat = await db
        .select()
        .from(chatDeployment)
        .where(and(
          eq(chatDeployment.id, chatId),
          eq(chatDeployment.userId, session.user.id)
        ))
        .limit(1)
      
      if (existingChat.length === 0) {
        return createErrorResponse('Chat not found or access denied', 404)
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
      if (subdomain && subdomain !== existingChat[0].subdomain) {
        const existingSubdomain = await db
          .select()
          .from(chatDeployment)
          .where(eq(chatDeployment.subdomain, subdomain))
          .limit(1)
        
        if (existingSubdomain.length > 0 && existingSubdomain[0].id !== chatId) {
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
      
      // Update the chat deployment
      await db
        .update(chatDeployment)
        .set(updateData)
        .where(eq(chatDeployment.id, chatId))
      
      // Return success response
      const updatedSubdomain = subdomain || existingChat[0].subdomain
      // Check if we're in development or production
      const isDevelopment = process.env.NODE_ENV === 'development'
      const chatUrl = isDevelopment
        ? `http://${updatedSubdomain}.localhost:3000`
        : `https://${updatedSubdomain}.simstudio.ai`
      
      logger.info(`Chat "${chatId}" updated successfully`)
      
      return createSuccessResponse({
        id: chatId,
        chatUrl,
        message: 'Chat deployment updated successfully'
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        const errorMessage = validationError.errors[0]?.message || 'Invalid request data'
        return createErrorResponse(errorMessage, 400, 'VALIDATION_ERROR')
      }
      throw validationError
    }
  } catch (error: any) {
    logger.error('Error updating chat deployment:', error)
    return createErrorResponse(error.message || 'Failed to update chat deployment', 500)
  }
}

/**
 * DELETE endpoint to remove a chat deployment
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const chatId = params.id
  
  try {
    const session = await getSession()
    
    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }
    
    // Verify the chat exists and belongs to the user
    const existingChat = await db
      .select()
      .from(chatDeployment)
      .where(and(
        eq(chatDeployment.id, chatId),
        eq(chatDeployment.userId, session.user.id)
      ))
      .limit(1)
    
    if (existingChat.length === 0) {
      return createErrorResponse('Chat not found or access denied', 404)
    }
    
    // Delete the chat deployment
    await db
      .delete(chatDeployment)
      .where(eq(chatDeployment.id, chatId))
    
    logger.info(`Chat "${chatId}" deleted successfully`)
    
    return createSuccessResponse({
      message: 'Chat deployment deleted successfully'
    })
  } catch (error: any) {
    logger.error('Error deleting chat deployment:', error)
    return createErrorResponse(error.message || 'Failed to delete chat deployment', 500)
  }
} 