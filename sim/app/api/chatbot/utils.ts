import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { decryptSecret } from '@/lib/utils'

const logger = createLogger('ChatbotAuthUtils')
const isDevelopment = process.env.NODE_ENV === 'development'

// Simple encryption for the auth token
export const encryptAuthToken = (subdomainId: string, type: string): string => {
    return Buffer.from(`${subdomainId}:${type}:${Date.now()}`).toString('base64')
  }
  
  // Decrypt and validate the auth token
  export const validateAuthToken = (token: string, subdomainId: string): boolean => {
    try {
      const decoded = Buffer.from(token, 'base64').toString()
      const [storedId, type, timestamp] = decoded.split(':')
      
      // Check if token is for this subdomain
      if (storedId !== subdomainId) {
        return false
      }
      
      // Check if token is not expired (24 hours)
      const createdAt = parseInt(timestamp)
      const now = Date.now()
      const expireTime = 24 * 60 * 60 * 1000 // 24 hours
      
      if (now - createdAt > expireTime) {
        return false
      }
      
      return true
    } catch (e) {
      return false
    }
  }
  
  // Set cookie helper function
  export const setChatbotAuthCookie = (response: NextResponse, subdomainId: string, type: string): void => {
    const token = encryptAuthToken(subdomainId, type)
    // Set cookie with HttpOnly and secure flags
    response.cookies.set({
      name: `chatbot_auth_${subdomainId}`,
      value: token,
      httpOnly: true,
      secure: !isDevelopment,
      sameSite: 'lax',
      path: '/',
      // Using subdomain for the domain in production
      domain: isDevelopment ? undefined : '.simstudio.ai',
      maxAge: 60 * 60 * 24, // 24 hours
    })
  }
  
  // Helper function to add CORS headers to responses
  export function addCorsHeaders(response: NextResponse, request: NextRequest) {
    // Get the origin from the request
    const origin = request.headers.get('origin') || ''
    
    // In development, allow any localhost subdomain
    if (isDevelopment && origin.includes('localhost')) {
      response.headers.set('Access-Control-Allow-Origin', origin)
      response.headers.set('Access-Control-Allow-Credentials', 'true')
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With')
    }
    
    return response
  }
  
  // Handle OPTIONS requests for CORS preflight
  export async function OPTIONS(request: NextRequest) {
    const response = new NextResponse(null, { status: 204 })
    return addCorsHeaders(response, request)
  }
  
  // Validate authentication for chatbot access
  export async function validateChatbotAuth(
    requestId: string,
    deployment: any,
    request: NextRequest,
    parsedBody?: any
  ): Promise<{ authorized: boolean, error?: string }> {
    const authType = deployment.authType || 'public'
    
    // Public chatbots are accessible to everyone
    if (authType === 'public') {
      return { authorized: true }
    }
    
    // Check for auth cookie first
    const cookieName = `chatbot_auth_${deployment.id}`
    const authCookie = request.cookies.get(cookieName)
    
    if (authCookie && validateAuthToken(authCookie.value, deployment.id)) {
      return { authorized: true }
    }
    
    // For password protection, check the password in the request body
    if (authType === 'password') {
      // For GET requests, we just notify the client that authentication is required
      if (request.method === 'GET') {
        return { authorized: false, error: 'auth_required_password' }
      }
      
      try {
        // Use the parsed body if provided, otherwise the auth check is not applicable
        if (!parsedBody) {
          return { authorized: false, error: 'Password is required' }
        }
        
        const { password, message } = parsedBody
        
        // If this is a chat message, not an auth attempt
        if (message && !password) {
          return { authorized: false, error: 'auth_required_password' }
        }
        
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
        // Use the parsed body if provided, otherwise the auth check is not applicable
        if (!parsedBody) {
          return { authorized: false, error: 'Email is required' }
        }
        
        const { email, message } = parsedBody
        
        // If this is a chat message, not an auth attempt
        if (message && !email) {
          return { authorized: false, error: 'auth_required_email' }
        }
        
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