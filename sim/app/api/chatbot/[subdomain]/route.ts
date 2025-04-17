import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { chatbotDeployment, workflow, apiKey as apiKeyTable } from '@/db/schema'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { addCorsHeaders, validateChatbotAuth, setChatbotAuthCookie, validateAuthToken } from '../utils'

const logger = createLogger('ChatbotSubdomainAPI')

// This endpoint handles chat interactions via the subdomain
export async function POST(request: NextRequest, { params }: { params: { subdomain: string } }) {
  const { subdomain } = params
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    logger.debug(`[${requestId}] Processing chatbot request for subdomain: ${subdomain}`)
    
    // Parse the request body once
    let parsedBody
    try {
      parsedBody = await request.json()
    } catch (error) {
      return addCorsHeaders(createErrorResponse('Invalid request body', 400), request)
    }
    
    // Find the chatbot deployment for this subdomain
    const deploymentResult = await db
      .select({
        id: chatbotDeployment.id,
        workflowId: chatbotDeployment.workflowId,
        userId: chatbotDeployment.userId,
        isActive: chatbotDeployment.isActive,
        authType: chatbotDeployment.authType,
        password: chatbotDeployment.password,
        allowedEmails: chatbotDeployment.allowedEmails,
      })
      .from(chatbotDeployment)
      .where(eq(chatbotDeployment.subdomain, subdomain))
      .limit(1)
    
    if (deploymentResult.length === 0) {
      logger.warn(`[${requestId}] Chatbot not found for subdomain: ${subdomain}`)
      return addCorsHeaders(createErrorResponse('Chatbot not found', 404), request)
    }
    
    const deployment = deploymentResult[0]
    
    // Check if the chatbot is active
    if (!deployment.isActive) {
      logger.warn(`[${requestId}] Chatbot is not active: ${subdomain}`)
      return addCorsHeaders(createErrorResponse('This chatbot is currently unavailable', 403), request)
    }
    
    // Validate authentication with the parsed body
    const authResult = await validateChatbotAuth(requestId, deployment, request, parsedBody)
    if (!authResult.authorized) {
      return addCorsHeaders(createErrorResponse(authResult.error || 'Authentication required', 401), request)
    }
    
    // Use the already parsed body
    const { message, password, email } = parsedBody
    
    // If this is an authentication request (has password or email but no message), 
    // set auth cookie and return success
    if ((password || email) && !message) {
      const response = addCorsHeaders(createSuccessResponse({ authenticated: true }), request)
      
      // Set authentication cookie
      setChatbotAuthCookie(response, deployment.id, deployment.authType)
      
      return response
    }
    
    // For chat messages, create regular response
    if (!message) {
      return addCorsHeaders(createErrorResponse('No message provided', 400), request)
    }
    
    // Get the workflow for this chatbot
    const workflowResult = await db
      .select({
        isDeployed: workflow.isDeployed,
      })
      .from(workflow)
      .where(eq(workflow.id, deployment.workflowId))
      .limit(1)
    
    if (workflowResult.length === 0 || !workflowResult[0].isDeployed) {
      logger.warn(`[${requestId}] Workflow not found or not deployed: ${deployment.workflowId}`)
      return addCorsHeaders(createErrorResponse('Chatbot workflow is not available', 503), request)
    }
    
    // Get the API key for the user
    const apiKeyResult = await db
      .select({
        key: apiKeyTable.key,
      })
      .from(apiKeyTable)
      .where(eq(apiKeyTable.userId, deployment.userId))
      .limit(1)
    
    if (apiKeyResult.length === 0) {
      logger.warn(`[${requestId}] No API key found for user: ${deployment.userId}`)
      return addCorsHeaders(createErrorResponse('Unable to process request', 500), request)
    }
    
    const apiKey = apiKeyResult[0].key
    
    // Forward the message to the workflow execution endpoint
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/workflows/${deployment.workflowId}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ input: message }),
    })
    
    if (!response.ok) {
      const errorData = await response.json()
      logger.error(`[${requestId}] Workflow execution failed:`, errorData)
      return addCorsHeaders(createErrorResponse('Failed to process message', response.status), request)
    }
    
    // Get the response from the workflow
    const result = await response.json()
    
    // Add CORS headers before returning the response
    return addCorsHeaders(createSuccessResponse(result), request)
  } catch (error: any) {
    logger.error(`[${requestId}] Error processing chatbot request:`, error)
    return addCorsHeaders(createErrorResponse(error.message || 'Failed to process request', 500), request)
  }
}

// This endpoint returns information about the chatbot
export async function GET(request: NextRequest, { params }: { params: Promise<{ subdomain: string }> }) {
  const { subdomain } = await params
  const requestId = crypto.randomUUID().slice(0, 8)
  
  try {
    logger.debug(`[${requestId}] Fetching chatbot info for subdomain: ${subdomain}`)
    
    // Find the chatbot deployment for this subdomain
    const deploymentResult = await db
      .select({
        id: chatbotDeployment.id,
        title: chatbotDeployment.title,
        description: chatbotDeployment.description,
        customizations: chatbotDeployment.customizations,
        isActive: chatbotDeployment.isActive,
        workflowId: chatbotDeployment.workflowId,
        authType: chatbotDeployment.authType,
        password: chatbotDeployment.password,
        allowedEmails: chatbotDeployment.allowedEmails,
      })
      .from(chatbotDeployment)
      .where(eq(chatbotDeployment.subdomain, subdomain))
      .limit(1)
    
    if (deploymentResult.length === 0) {
      logger.warn(`[${requestId}] Chatbot not found for subdomain: ${subdomain}`)
      return addCorsHeaders(createErrorResponse('Chatbot not found', 404), request)
    }
    
    const deployment = deploymentResult[0]
    
    // Check if the chatbot is active
    if (!deployment.isActive) {
      logger.warn(`[${requestId}] Chatbot is not active: ${subdomain}`)
      return addCorsHeaders(createErrorResponse('This chatbot is currently unavailable', 403), request)
    }
    
    // Check for auth cookie first
    const cookieName = `chatbot_auth_${deployment.id}`
    const authCookie = request.cookies.get(cookieName)
    
    if (deployment.authType !== 'public' && authCookie && validateAuthToken(authCookie.value, deployment.id)) {
      // Cookie valid, return chatbot info
      return addCorsHeaders(createSuccessResponse({
        id: deployment.id,
        title: deployment.title,
        description: deployment.description, 
        customizations: deployment.customizations,
        authType: deployment.authType,
      }), request)
    }
    
    // If no valid cookie, proceed with standard auth check
    const authResult = await validateChatbotAuth(requestId, deployment, request)
    if (!authResult.authorized) {
      logger.info(`[${requestId}] Authentication required for chatbot: ${subdomain}, type: ${deployment.authType}`)
      return addCorsHeaders(createErrorResponse(authResult.error || 'Authentication required', 401), request)
    }
    
    // Return public information about the chatbot including auth type
    return addCorsHeaders(createSuccessResponse({
      id: deployment.id,
      title: deployment.title,
      description: deployment.description, 
      customizations: deployment.customizations,
      authType: deployment.authType,
    }), request)
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching chatbot info:`, error)
    return addCorsHeaders(createErrorResponse(error.message || 'Failed to fetch chatbot information', 500), request)
  }
} 