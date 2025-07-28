import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('SimAgentClient')

// Base URL for the sim-agent service
const SIM_AGENT_BASE_URL = env.NODE_ENV === 'development' 
  ? 'http://localhost:8000'
  : (env.NEXT_PUBLIC_SIM_AGENT_URL || 'https://sim-agent.vercel.app')

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
  private apiKey: string

  constructor() {
    this.baseUrl = SIM_AGENT_BASE_URL
    this.apiKey = env.SIM_AGENT_API_KEY || ''
    
    if (!this.apiKey) {
      logger.warn('SIM_AGENT_API_KEY not configured')
    }
  }

  /**
   * Make a request to the sim-agent service
   */
  private async makeRequest<T = any>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
      body?: Record<string, any>
      headers?: Record<string, string>
    } = {}
  ): Promise<SimAgentResponse<T>> {
    const requestId = crypto.randomUUID().slice(0, 8)
    const { method = 'POST', body, headers = {} } = options

    try {
      const url = `${this.baseUrl}${endpoint}`
      
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        ...headers,
      }

      logger.info(`[${requestId}] Making request to sim-agent`, {
        url,
        method,
        hasApiKey: !!this.apiKey,
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
      hasApiKey: !!this.apiKey,
      environment: env.NODE_ENV,
    }
  }
}

// Export singleton instance
export const simAgentClient = new SimAgentClient()

// Export types and class for advanced usage
export { SimAgentClient } 