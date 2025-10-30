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
  needsRedeployment: boolean
}

export interface ExecutionOptions {
  input?: any
  timeout?: number
  stream?: boolean
  selectedOutputs?: string[]
  async?: boolean
}

export interface AsyncExecutionResult {
  success: boolean
  taskId: string
  status: 'queued'
  createdAt: string
  links: {
    status: string
  }
}

export interface RateLimitInfo {
  limit: number
  remaining: number
  reset: number
  retryAfter?: number
}

export interface RetryOptions {
  maxRetries?: number
  initialDelay?: number
  maxDelay?: number
  backoffMultiplier?: number
}

export interface UsageLimits {
  success: boolean
  rateLimit: {
    sync: {
      isLimited: boolean
      limit: number
      remaining: number
      resetAt: string
    }
    async: {
      isLimited: boolean
      limit: number
      remaining: number
      resetAt: string
    }
    authType: string
  }
  usage: {
    currentPeriodCost: number
    limit: number
    plan: string
  }
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

/**
 * Remove trailing slashes from a URL
 * Uses string operations instead of regex to prevent ReDoS attacks
 * @param url - The URL to normalize
 * @returns URL without trailing slashes
 */
function normalizeBaseUrl(url: string): string {
  let normalized = url
  while (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

export class SimStudioClient {
  private apiKey: string
  private baseUrl: string
  private rateLimitInfo: RateLimitInfo | null = null

  constructor(config: SimStudioConfig) {
    this.apiKey = config.apiKey
    this.baseUrl = normalizeBaseUrl(config.baseUrl || 'https://sim.ai')
  }

  /**
   * Execute a workflow with optional input data
   * If async is true, returns immediately with a task ID
   */
  /**
   * Convert File objects in input to API format (base64)
   * Recursively processes nested objects and arrays
   */
  private async convertFilesToBase64(
    value: any,
    visited: WeakSet<object> = new WeakSet()
  ): Promise<any> {
    if (value instanceof File) {
      const arrayBuffer = await value.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const base64 = buffer.toString('base64')

      return {
        type: 'file',
        data: `data:${value.type || 'application/octet-stream'};base64,${base64}`,
        name: value.name,
        mime: value.type || 'application/octet-stream',
      }
    }

    if (Array.isArray(value)) {
      if (visited.has(value)) {
        return '[Circular]'
      }
      visited.add(value)
      const result = await Promise.all(
        value.map((item) => this.convertFilesToBase64(item, visited))
      )
      visited.delete(value)
      return result
    }

    if (value !== null && typeof value === 'object') {
      if (visited.has(value)) {
        return '[Circular]'
      }
      visited.add(value)
      const converted: any = {}
      for (const [key, val] of Object.entries(value)) {
        converted[key] = await this.convertFilesToBase64(val, visited)
      }
      visited.delete(value)
      return converted
    }

    return value
  }

  async executeWorkflow(
    workflowId: string,
    options: ExecutionOptions = {}
  ): Promise<WorkflowExecutionResult | AsyncExecutionResult> {
    const url = `${this.baseUrl}/api/workflows/${workflowId}/execute`
    const { input, timeout = 30000, stream, selectedOutputs, async } = options

    try {
      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('TIMEOUT')), timeout)
      })

      // Build headers - async execution uses X-Execution-Mode header
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      }
      if (async) {
        headers['X-Execution-Mode'] = 'async'
      }

      // Build JSON body - spread input at root level, then add API control parameters
      let jsonBody: any = input !== undefined ? { ...input } : {}

      // Convert any File objects in the input to base64 format
      jsonBody = await this.convertFilesToBase64(jsonBody)

      if (stream !== undefined) {
        jsonBody.stream = stream
      }
      if (selectedOutputs !== undefined) {
        jsonBody.selectedOutputs = selectedOutputs
      }

      const fetchPromise = fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(jsonBody),
      })

      const response = await Promise.race([fetchPromise, timeoutPromise])

      // Extract rate limit headers
      this.updateRateLimitInfo(response)

      // Handle rate limiting with retry
      if (response.status === 429) {
        const retryAfter = this.rateLimitInfo?.retryAfter || 1000
        throw new SimStudioError(
          `Rate limit exceeded. Retry after ${retryAfter}ms`,
          'RATE_LIMIT_EXCEEDED',
          429
        )
      }

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as unknown as any
        throw new SimStudioError(
          errorData.error || `HTTP ${response.status}: ${response.statusText}`,
          errorData.code,
          response.status
        )
      }

      const result = await response.json()
      return result as WorkflowExecutionResult | AsyncExecutionResult
    } catch (error: any) {
      if (error instanceof SimStudioError) {
        throw error
      }

      if (error.message === 'TIMEOUT') {
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
    // Ensure sync mode by explicitly setting async to false
    const syncOptions = { ...options, async: false }
    return this.executeWorkflow(workflowId, syncOptions) as Promise<WorkflowExecutionResult>
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
    this.baseUrl = normalizeBaseUrl(baseUrl)
  }

  /**
   * Get the status of an async job
   * @param taskId The task ID returned from async execution
   */
  async getJobStatus(taskId: string): Promise<any> {
    const url = `${this.baseUrl}/api/jobs/${taskId}`

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': this.apiKey,
        },
      })

      this.updateRateLimitInfo(response)

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as unknown as any
        throw new SimStudioError(
          errorData.error || `HTTP ${response.status}: ${response.statusText}`,
          errorData.code,
          response.status
        )
      }

      const result = await response.json()
      return result
    } catch (error: any) {
      if (error instanceof SimStudioError) {
        throw error
      }

      throw new SimStudioError(error?.message || 'Failed to get job status', 'STATUS_ERROR')
    }
  }

  /**
   * Execute workflow with automatic retry on rate limit
   */
  async executeWithRetry(
    workflowId: string,
    options: ExecutionOptions = {},
    retryOptions: RetryOptions = {}
  ): Promise<WorkflowExecutionResult | AsyncExecutionResult> {
    const {
      maxRetries = 3,
      initialDelay = 1000,
      maxDelay = 30000,
      backoffMultiplier = 2,
    } = retryOptions

    let lastError: SimStudioError | null = null
    let delay = initialDelay

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.executeWorkflow(workflowId, options)
      } catch (error: any) {
        if (!(error instanceof SimStudioError) || error.code !== 'RATE_LIMIT_EXCEEDED') {
          throw error
        }

        lastError = error

        // Don't retry after last attempt
        if (attempt === maxRetries) {
          break
        }

        // Use retry-after if provided, otherwise use exponential backoff
        const waitTime =
          error.status === 429 && this.rateLimitInfo?.retryAfter
            ? this.rateLimitInfo.retryAfter
            : Math.min(delay, maxDelay)

        // Add jitter (±25%)
        const jitter = waitTime * (0.75 + Math.random() * 0.5)

        await new Promise((resolve) => setTimeout(resolve, jitter))

        // Exponential backoff for next attempt
        delay *= backoffMultiplier
      }
    }

    throw lastError || new SimStudioError('Max retries exceeded', 'MAX_RETRIES_EXCEEDED')
  }

  /**
   * Get current rate limit information
   */
  getRateLimitInfo(): RateLimitInfo | null {
    return this.rateLimitInfo
  }

  /**
   * Update rate limit info from response headers
   * @private
   */
  private updateRateLimitInfo(response: any): void {
    const limit = response.headers.get('x-ratelimit-limit')
    const remaining = response.headers.get('x-ratelimit-remaining')
    const reset = response.headers.get('x-ratelimit-reset')
    const retryAfter = response.headers.get('retry-after')

    if (limit || remaining || reset) {
      this.rateLimitInfo = {
        limit: limit ? Number.parseInt(limit, 10) : 0,
        remaining: remaining ? Number.parseInt(remaining, 10) : 0,
        reset: reset ? Number.parseInt(reset, 10) : 0,
        retryAfter: retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : undefined,
      }
    }
  }

  /**
   * Get current usage limits and quota information
   */
  async getUsageLimits(): Promise<UsageLimits> {
    const url = `${this.baseUrl}/api/users/me/usage-limits`

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': this.apiKey,
        },
      })

      this.updateRateLimitInfo(response)

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as unknown as any
        throw new SimStudioError(
          errorData.error || `HTTP ${response.status}: ${response.statusText}`,
          errorData.code,
          response.status
        )
      }

      const result = await response.json()
      return result as UsageLimits
    } catch (error: any) {
      if (error instanceof SimStudioError) {
        throw error
      }

      throw new SimStudioError(error?.message || 'Failed to get usage limits', 'USAGE_ERROR')
    }
  }
}

// Export types and classes
export { SimStudioClient as default }
