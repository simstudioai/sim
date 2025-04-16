import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { chatbotDeployment, workflow, apiKey as apiKeyTable } from '@/db/schema'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { decryptSecret } from '@/lib/utils'

const logger = createLogger('ChatbotSubdomainAPI')

// Validate authentication for chatbot access
async function validateChatbotAuth(
  requestId: string,
  deployment: any,
  request: NextRequest
): Promise<{ authorized: boolean; error?: string }> {
  const authType = deployment.authType || 'public'
  
  // Public chatbots are accessible to everyone
  if (authType === 'public') {
    return { authorized: true }
  }
  
  // For password protection, check the password in the request body
  if (authType === 'password') {
    // For GET requests, we just notify the client that authentication is required
    if (request.method === 'GET') {
      return { authorized: false, error: 'auth_required_password' }
    }
    
    try {
      const body = await request.json()
      const { password } = body
      
      if (!password) {
        return { authorized: false, error: 'Password is required' }
      }
      
      if (!deployment.password) {
        logger.error(`[${requestId}] No password set for password-protected chatbot: ${deployment.id}`)
        return { authorized: false, error: 'Authentication configuration error' }
      }
      
      // Decrypt the stored password and compare
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
  
  // For email access control, check the email in the request body
  if (authType === 'email') {
    // For GET requests, we just notify the client that authentication is required
    if (request.method === 'GET') {
      return { authorized: false, error: 'auth_required_email' }
    }
    
    try {
      const body = await request.json()
      const { email } = body
      
      if (!email) {
        return { authorized: false, error: 'Email is required' }
      }
      
      const allowedEmails = deployment.allowedEmails || []
      
      // Check exact email matches
      if (allowedEmails.includes(email)) {
        return { authorized: true }
      }
      
      // Check domain matches (prefixed with @)
      const domain = email.split('@')[1]
      if (domain && allowedEmails.some((allowed: string) => allowed === `@${domain}`)) {
        return { authorized: true }
      }
      
      return { authorized: false, error: 'Email not authorized' }
    } catch (error) {
      logger.error(`[${requestId}] Error validating email:`, error)
      return { authorized: false, error: 'Authentication error' }
    }
  }
  
  // Unknown auth type
  return { authorized: false, error: 'Unsupported authentication type' }
}

// This endpoint handles chat interactions via the subdomain
export async function POST(request: NextRequest, { params }: { params: { subdomain: string } }) {
  const { subdomain } = params
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    logger.debug(`[${requestId}] Processing chatbot request for subdomain: ${subdomain}`)
    
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
      return createErrorResponse('Chatbot not found', 404)
    }
    
    const deployment = deploymentResult[0]
    
    // Check if the chatbot is active
    if (!deployment.isActive) {
      logger.warn(`[${requestId}] Chatbot is not active: ${subdomain}`)
      return createErrorResponse('This chatbot is currently unavailable', 403)
    }
    
    // Validate authentication
    const authResult = await validateChatbotAuth(requestId, deployment, request)
    if (!authResult.authorized) {
      return createErrorResponse(authResult.error || 'Authentication required', 401)
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
      return createErrorResponse('Chatbot workflow is not available', 503)
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
      return createErrorResponse('Unable to process request', 500)
    }
    
    const apiKey = apiKeyResult[0].key
    
    // Get the chat message from the request
    const body = await request.json()
    const { message } = body
    
    if (!message) {
      return createErrorResponse('No message provided', 400)
    }
    
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
      return createErrorResponse('Failed to process message', response.status)
    }
    
    // Get the response from the workflow
    const result = await response.json()
    
    return createSuccessResponse(result)
  } catch (error: any) {
    logger.error(`[${requestId}] Error processing chatbot request:`, error)
    return createErrorResponse(error.message || 'Failed to process request', 500)
  }
}

// This endpoint returns information about the chatbot
export async function GET(request: NextRequest, { params }: { params: { subdomain: string } }) {
  const { subdomain } = params
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
      })
      .from(chatbotDeployment)
      .where(eq(chatbotDeployment.subdomain, subdomain))
      .limit(1)
    
    if (deploymentResult.length === 0) {
      logger.warn(`[${requestId}] Chatbot not found for subdomain: ${subdomain}`)
      return createErrorResponse('Chatbot not found', 404)
    }
    
    const deployment = deploymentResult[0]
    
    // Check if the chatbot is active
    if (!deployment.isActive) {
      logger.warn(`[${requestId}] Chatbot is not active: ${subdomain}`)
      return createErrorResponse('This chatbot is currently unavailable', 403)
    }
    
    // Return public information about the chatbot including auth type
    return createSuccessResponse({
      id: deployment.id,
      title: deployment.title,
      description: deployment.description, 
      customizations: deployment.customizations,
      authType: deployment.authType,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching chatbot info:`, error)
    return createErrorResponse(error.message || 'Failed to fetch chatbot information', 500)
  }
} 