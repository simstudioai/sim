import { createLogger } from '@/lib/logs/console-logger'
import type { WorkflowState, BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('YamlServiceClient')

interface ParseYamlResponse {
  success: boolean
  data?: any
  errors: string[]
}

interface ConvertYamlToWorkflowResponse {
  success: boolean
  workflowState?: WorkflowState
  errors: string[]
  warnings: string[]
  idMapping?: Record<string, string>
}

interface GenerateYamlResponse {
  success: boolean
  yaml?: string
  error?: string
}

interface DiffYamlResponse {
  changes: any[]
  errors: string[]
}

export class YamlServiceClient {
  constructor() {
    logger.info('YamlServiceClient initialized')
  }

  /**
   * Make a request to our API routes
   */
  private async fetchFromAPI(endpoint: string, body: any): Promise<any> {
    try {
      const response = await fetch(`/api/yaml${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        logger.error(`API error for ${endpoint}:`, {
          status: response.status,
          error: errorData,
        })
        throw new Error(errorData?.error || `API error: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      logger.error(`Failed to call API ${endpoint}:`, error)
      throw error
    }
  }

  async parseYaml(yamlContent: string): Promise<ParseYamlResponse> {
    return this.fetchFromAPI('/parse', { yamlContent })
  }

  async convertYamlToWorkflow(
    yamlContent: string,
    options?: {
      generateNewIds?: boolean
      preservePositions?: boolean
      existingBlocks?: Record<string, BlockState>
    }
  ): Promise<ConvertYamlToWorkflowResponse> {
    return this.fetchFromAPI('/to-workflow', {
      yamlContent,
      options
    })
  }

  async generateYaml(
    workflowState: WorkflowState,
    subBlockValues?: Record<string, Record<string, any>>
  ): Promise<GenerateYamlResponse> {
    return this.fetchFromAPI('/generate', {
      workflowState,
      subBlockValues
    })
  }

  async diffYaml(originalYaml: string, modifiedYaml: string): Promise<DiffYamlResponse> {
    return this.fetchFromAPI('/diff', {
      originalYaml,
      modifiedYaml
    })
  }

  // Helper method to check if external service is available
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch('/api/yaml/health', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        logger.error('YAML service health check failed:', {
          status: response.status,
        })
        return false
      }

      const data = await response.json()
      return data.healthy === true
    } catch (error) {
      logger.error('YAML service health check failed:', error)
      return false
    }
  }
}

// Export singleton instance
export const yamlService = new YamlServiceClient()

// Export types for consumers
export type { ParseYamlResponse, ConvertYamlToWorkflowResponse, GenerateYamlResponse, DiffYamlResponse } 