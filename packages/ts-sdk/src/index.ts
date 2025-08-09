import fetch from 'node-fetch'

export interface SimStudioConfig {
  apiKey: string
  baseUrl?: string
}

export interface WorkflowExecutionResult {
  success: boolean
  output?: any
  error?: string
  logs?: any[]
  metadata?: {
    duration?: number
    executionId?: string
    [key: string]: any
  }
  traceSpans?: any[]
  totalDuration?: number
}

export interface WorkflowStatus {
  isDeployed: boolean
  deployedAt?: string
  isPublished: boolean
  needsRedeployment: boolean
}

export interface ExecutionOptions {
  input?: any
  timeout?: number
}

export class SimStudioError extends Error {
  public code?: string
  public status?: number

  constructor(message: string, code?: string, status?: number) {
    super(message)
    this.name = 'SimStudioError'
    this.code = code
    this.status = status
  }
}

export class SimStudioClient {
  private apiKey: string
  private baseUrl: string

  constructor(config: SimStudioConfig) {
    this.apiKey = config.apiKey
    this.baseUrl = (config.baseUrl || 'https://sim.ai').replace(/\/+$/, '')
  }

  /**
   * Execute a workflow with optional input data
   */
  async executeWorkflow(
    workflowId: string,
    options: ExecutionOptions = {}
  ): Promise<WorkflowExecutionResult> {
    const url = `${this.baseUrl}/api/workflows/${workflowId}/execute`
    const { input, timeout = 30000 } = options

    try {
      const abortController = new AbortController()
      const timeoutId = setTimeout(() => abortController.abort(), timeout)

      try {
        const fetchPromise = fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
          },
          body: JSON.stringify(input || {}),
          signal: abortController.signal, // Attach the abort signal
        })

        const response = await fetchPromise // No need for Promise.race here anymore

        clearTimeout(timeoutId) // Clear the timeout if fetch completes first

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as unknown as any
        throw new SimStudioError(
          errorData.error || `HTTP ${response.status}: ${response.statusText}`,
          errorData.code,
          response.status
        )
      }

      const result = await response.json()
      return result as WorkflowExecutionResult
    } catch (error: any) {
        clearTimeout(timeoutId) // Ensure timeout is cleared on error too

        if (error.name === 'AbortError') {
          throw new SimStudioError(`Workflow execution timed out after ${timeout}ms`, 'TIMEOUT')
        }

      throw new SimStudioError(error?.message || 'Failed to execute workflow', 'EXECUTION_ERROR')
    }
  }

  /**
   * Get the status of a workflow (deployment status, etc.)
   */
  async getWorkflowStatus(workflowId: string): Promise<WorkflowStatus> {
    const url = `${this.baseUrl}/api/workflows/${workflowId}/status`

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': this.apiKey,
        },
      })

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as unknown as any
        throw new SimStudioError(
          errorData.error || `HTTP ${response.status}: ${response.statusText}`,
          errorData.code,
          response.status
        )
      }

      const result = await response.json()
      return result as WorkflowStatus
    } catch (error: any) {
      if (error instanceof SimStudioError) {
        throw error
      }

      throw new SimStudioError(error?.message || 'Failed to get workflow status', 'STATUS_ERROR')
    }
  }

  /**
   * Execute a workflow and poll for completion (useful for long-running workflows)
   */
  async executeWorkflowSync(
    workflowId: string,
    options: ExecutionOptions = {}
  ): Promise<WorkflowExecutionResult> {
    // For now, the API is synchronous, so we just execute directly
    // In the future, if async execution is added, this method can be enhanced
    return this.executeWorkflow(workflowId, options)
  }

  /**
   * Validate that a workflow is ready for execution
   */
  async validateWorkflow(workflowId: string): Promise<boolean> {
    try {
      const status = await this.getWorkflowStatus(workflowId)
      return status.isDeployed
    } catch (error) {
      return false
    }
  }

  /**
   * Set a new API key
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey
  }

  /**
   * Set a new base URL
   */
  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }
}

// Export types and classes
export { SimStudioClient as default }
