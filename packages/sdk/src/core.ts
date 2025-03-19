import axios, { AxiosInstance } from 'axios'
import { SimStudioConfig, Workflow, ExecutionResult, DeploymentOptions, DeploymentResult, ScheduleOptions, ScheduleResult } from './types'
import { WorkflowBuilder } from './workflows/builder'
import { BlockRegistry, BlockImport } from './blocks/registry'
import { Tool, ToolRegistry } from './tools'

/**
 * Main SDK class for Sim Studio
 */
export class SimStudio {
  private client: AxiosInstance
  private config: Required<SimStudioConfig>

  /**
   * Create a new Sim Studio SDK instance
   */
  constructor(config: SimStudioConfig = {}) {
    this.config = {
      apiKey: config.apiKey ?? process.env.SIM_STUDIO_API_KEY ?? '',
      baseUrl: config.baseUrl ?? process.env.SIM_STUDIO_API_URL ?? 'https://api.simstudio.dev',
      timeout: config.timeout ?? 30000,
    }

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
    })
  }

  /**
   * Create a new workflow builder
   */
  createWorkflow(name: string, description?: string): WorkflowBuilder {
    return new WorkflowBuilder(name, description)
  }

  /**
   * Get a workflow by ID
   */
  async getWorkflow(id: string): Promise<Workflow> {
    const response = await this.client.get(`/workflows/${id}`)
    return response.data
  }

  /**
   * List all workflows
   */
  async listWorkflows(params: { limit?: number; offset?: number } = {}): Promise<Workflow[]> {
    const response = await this.client.get('/workflows', { params })
    return response.data
  }

  /**
   * Save a workflow
   */
  async saveWorkflow(workflow: Workflow): Promise<Workflow> {
    if (workflow.id) {
      const response = await this.client.put(`/workflows/${workflow.id}`, workflow)
      return response.data
    } else {
      const response = await this.client.post('/workflows', workflow)
      return response.data
    }
  }

  /**
   * Delete a workflow
   */
  async deleteWorkflow(id: string): Promise<void> {
    await this.client.delete(`/workflows/${id}`)
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(id: string, input?: Record<string, any>): Promise<ExecutionResult> {
    const response = await this.client.post(`/workflows/${id}/execute`, { input })
    return response.data
  }

  /**
   * Deploy a workflow as an API endpoint
   */
  async deployWorkflow(id: string, options: DeploymentOptions = {}): Promise<DeploymentResult> {
    const response = await this.client.post(`/workflows/${id}/deploy`, options)
    return response.data
  }

  /**
   * Get deployment details
   */
  async getDeployment(workflowId: string): Promise<DeploymentResult> {
    const response = await this.client.get(`/workflows/${workflowId}/deployment`)
    return response.data
  }

  /**
   * Remove a workflow deployment
   */
  async undeployWorkflow(workflowId: string): Promise<void> {
    await this.client.delete(`/workflows/${workflowId}/deployment`)
  }

  /**
   * Schedule a workflow
   */
  async scheduleWorkflow(workflowId: string, options: ScheduleOptions): Promise<ScheduleResult> {
    const response = await this.client.post(`/workflows/${workflowId}/schedule`, options)
    return response.data
  }

  /**
   * Get a workflow schedule
   */
  async getSchedule(scheduleId: string): Promise<ScheduleResult> {
    const response = await this.client.get(`/schedules/${scheduleId}`)
    return response.data
  }

  /**
   * List schedules for a workflow
   */
  async listSchedules(workflowId: string): Promise<ScheduleResult[]> {
    const response = await this.client.get(`/workflows/${workflowId}/schedules`)
    return response.data
  }

  /**
   * Delete a schedule
   */
  async deleteSchedule(scheduleId: string): Promise<void> {
    await this.client.delete(`/schedules/${scheduleId}`)
  }

  /**
   * Register blocks from the main application
   */
  static registerBlocks(blocks: BlockImport[]): void {
    blocks.forEach(block => {
      BlockRegistry.register(block.id, block.blockClass, block.options)
    })
  }

  /**
   * Register tools from the main application
   */
  static registerTools(tools: Tool[]): void {
    tools.forEach(tool => {
      ToolRegistry.register(tool)
    })
  }

  /**
   * Get all registered blocks
   */
  static getRegisteredBlocks(): string[] {
    return BlockRegistry.getAll()
  }

  /**
   * Get all registered tools
   */
  static getRegisteredTools(): Tool[] {
    return ToolRegistry.getAll()
  }
} 