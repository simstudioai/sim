import { createLogger } from '@/lib/logs/console-logger'
import { getAllBlocks } from '@/blocks'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import { resolveOutputType } from '@/blocks/utils'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'
import type { BlockConfig } from '@/blocks/types'

const logger = createLogger('YamlServiceClient')

interface YamlServiceConfig {
  blockRegistry: Record<string, BlockConfig>
  utilities: {
    generateLoopBlocks: string
    generateParallelBlocks: string
    resolveOutputType: string
  }
}

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
  private simAgentClient: any

  constructor() {
    // Lazy load sim-agent client to avoid circular dependencies
    this.simAgentClient = null
  }

  private async getSimAgentClient() {
    if (!this.simAgentClient) {
      const { simAgentClient } = await import('@/lib/sim-agent/client')
      this.simAgentClient = simAgentClient
    }
    return this.simAgentClient
  }

  private async getConfig(): Promise<YamlServiceConfig> {
    // Gather all dependencies needed by the YAML service
    const blocks = getAllBlocks()
    const blockRegistry = blocks.reduce((acc, block) => {
      // Get the block type from the block config
      const blockType = block.type
      acc[blockType] = {
        ...block,
        id: blockType,  // Add id field for YAML service
        subBlocks: block.subBlocks || [],
        outputs: block.outputs || {},
      } as any
      return acc
    }, {} as Record<string, BlockConfig>)

    return {
      blockRegistry,
      utilities: {
        generateLoopBlocks: generateLoopBlocks.toString(),
        generateParallelBlocks: generateParallelBlocks.toString(),
        resolveOutputType: resolveOutputType.toString()
      }
    }
  }

  private async fetchFromService(endpoint: string, body: any): Promise<any> {
    try {
      const client = await this.getSimAgentClient()
      
      // Use the sim-agent client to make the request
      const response = await client.call(endpoint, {
        workflowId: body.workflowId || 'yaml-service',
        data: body
      })

      if (!response.success) {
        throw new Error(response.error || 'YAML service error')
      }

      return response.data
    } catch (error) {
      logger.error(`Failed to call YAML service ${endpoint}:`, error)
      throw error
    }
  }

  async parseYaml(yamlContent: string): Promise<ParseYamlResponse> {
    return this.fetchFromService('/api/yaml/parse', { yamlContent })
  }

  async convertYamlToWorkflow(
    yamlContent: string,
    options?: {
      generateNewIds?: boolean
      preservePositions?: boolean
      existingBlocks?: Record<string, BlockState>
    }
  ): Promise<ConvertYamlToWorkflowResponse> {
    const config = await this.getConfig()
    return this.fetchFromService('/api/yaml/to-workflow', {
      yamlContent,
      ...config,
      options
    })
  }

  async generateYaml(
    workflowState: WorkflowState,
    subBlockValues?: Record<string, Record<string, any>>
  ): Promise<GenerateYamlResponse> {
    const config = await this.getConfig()
    return this.fetchFromService('/api/workflow/to-yaml', {
      workflowState,
      subBlockValues,
      ...config
    })
  }

  async diffYaml(originalYaml: string, modifiedYaml: string): Promise<DiffYamlResponse> {
    const config = await this.getConfig()
    return this.fetchFromService('/api/yaml/diff', {
      originalYaml,
      modifiedYaml,
      ...config
    })
  }

  // Helper method to check if external service is available
  async healthCheck(): Promise<boolean> {
    try {
      const client = await this.getSimAgentClient()
      // Check if sim-agent is configured and available
      const config = client.getConfig()
      return !!config.baseUrl && !!config.hasApiKey
    } catch {
      return false
    }
  }
}

// Export singleton instance
export const yamlService = new YamlServiceClient()

// Export types for consumers
export type { ParseYamlResponse, ConvertYamlToWorkflowResponse, GenerateYamlResponse, DiffYamlResponse } 