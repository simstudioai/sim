import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SimAgentClient')

// Base URL for the sim-agent service
const SIM_AGENT_BASE_URL =
  process.env.NODE_ENV === 'development'
    ? 'http://localhost:8000'
    : process.env.NEXT_PUBLIC_SIM_AGENT_URL || 'https://sim-agent.vercel.app'

export interface SimAgentRequest {
  workflowId: string
  userId?: string
  data?: Record<string, any>
}

export interface SimAgentResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  status?: number
}

class SimAgentClient {
  private baseUrl: string

  constructor() {
    this.baseUrl = SIM_AGENT_BASE_URL
  }

  /**
   * Get the API key lazily to ensure environment variables are loaded
   */
  private getApiKey(): string {
    // Only try server-side env var (never expose to client)
    let apiKey = process.env.SIM_AGENT_API_KEY || ''

    // If not found, try importing env library as fallback
    if (!apiKey) {
      try {
        const { env } = require('@/lib/env')
        apiKey = env.SIM_AGENT_API_KEY || ''
      } catch (e) {
        // env library not available or failed to load
      }
    }

    if (!apiKey && typeof window === 'undefined') {
      // Only warn on server-side where API key should be available
      logger.warn('SIM_AGENT_API_KEY not configured')
    }

    return apiKey
  }

  /**
   * Make a request to the sim-agent service
   */
  async makeRequest<T = any>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
      body?: Record<string, any>
      headers?: Record<string, string>
      apiKey?: string // Allow passing API key directly
    } = {}
  ): Promise<SimAgentResponse<T>> {
    const requestId = crypto.randomUUID().slice(0, 8)
    const { method = 'POST', body, headers = {}, apiKey: providedApiKey } = options

    try {
      const url = `${this.baseUrl}${endpoint}`

      // Use provided API key or try to get it from environment
      const apiKey = providedApiKey || this.getApiKey()
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(apiKey && { 'x-api-key': apiKey }),
        ...headers,
      }

      logger.info(`[${requestId}] Making request to sim-agent`, {
        url,
        method,
        hasApiKey: !!apiKey,
        hasBody: !!body,
      })

      const fetchOptions: RequestInit = {
        method,
        headers: requestHeaders,
      }

      if (body && (method === 'POST' || method === 'PUT')) {
        fetchOptions.body = JSON.stringify(body)
      }

      const response = await fetch(url, fetchOptions)
      const responseStatus = response.status

      let responseData
      try {
        const responseText = await response.text()
        responseData = responseText ? JSON.parse(responseText) : null
      } catch (parseError) {
        logger.error(`[${requestId}] Failed to parse response`, parseError)
        return {
          success: false,
          error: `Failed to parse response: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`,
          status: responseStatus,
        }
      }

      logger.info(`[${requestId}] Response received`, {
        status: responseStatus,
        success: response.ok,
        hasData: !!responseData,
      })

      return {
        success: response.ok,
        data: responseData,
        error: response.ok ? undefined : responseData?.error || `HTTP ${responseStatus}`,
        status: responseStatus,
      }
    } catch (fetchError) {
      logger.error(`[${requestId}] Request failed`, fetchError)
      return {
        success: false,
        error: `Connection failed: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`,
        status: 0,
      }
    }
  }

  /**
   * Generic method for custom API calls
   */
  async call<T = any>(
    endpoint: string,
    request: SimAgentRequest,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST'
  ): Promise<SimAgentResponse<T>> {
    return this.makeRequest<T>(endpoint, {
      method,
      body: {
        workflowId: request.workflowId,
        userId: request.userId,
        ...request.data,
      },
    })
  }

  /**
   * Get the current configuration
   */
  getConfig() {
    return {
      baseUrl: this.baseUrl,
      hasApiKey: !!this.getApiKey(),
      environment: process.env.NODE_ENV,
    }
  }

  /**
   * Check if the sim-agent service is healthy
   */
  async healthCheck() {
    try {
      const response = await this.makeRequest('/health', { method: 'GET' })
      return response.success && response.data?.healthy === true
    } catch (error) {
      logger.error('Sim-agent health check failed:', error)
      return false
    }
  }
}

// Export singleton instance
export const simAgentClient = new SimAgentClient()

// Export types and class for advanced usage
export { SimAgentClient }
