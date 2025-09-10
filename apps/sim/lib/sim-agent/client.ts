import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { SIM_AGENT_API_URL_DEFAULT } from '@/lib/sim-agent'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('SimAgentClient')

const SIM_AGENT_BASE_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

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
    const requestId = generateRequestId()
    const { method = 'POST', body, headers = {} } = options

    try {
      const url = `${this.baseUrl}${endpoint}`

      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...headers,
      }

      logger.info(`[${requestId}] Making request to sim-agent`, {
        url,
        method,
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
