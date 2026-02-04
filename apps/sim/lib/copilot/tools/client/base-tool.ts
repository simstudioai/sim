// Lazy require in setState to avoid circular init issues
import { createLogger } from '@sim/logger'
import type { LucideIcon } from 'lucide-react'
import type { ToolUIConfig } from './ui-config'

const baseToolLogger = createLogger('BaseClientTool')

const DEFAULT_TOOL_TIMEOUT_MS = 5 * 60 * 1000

export const WORKFLOW_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000

// Client tool call states used by the new runtime
export enum ClientToolCallState {
  generating = 'generating',
  pending = 'pending',
  executing = 'executing',
  aborted = 'aborted',
  rejected = 'rejected',
  success = 'success',
  error = 'error',
  review = 'review',
  background = 'background',
}

// Display configuration for a given state
export interface ClientToolDisplay {
  text: string
  icon: LucideIcon
}

/**
 * Function to generate dynamic display text based on tool parameters and state
 * @param params - The tool call parameters
 * @param state - The current tool call state
 * @returns The dynamic text to display, or undefined to use the default text
 */
export type DynamicTextFormatter = (
  params: Record<string, any>,
  state: ClientToolCallState
) => string | undefined

export interface BaseClientToolMetadata {
  displayNames: Partial<Record<ClientToolCallState, ClientToolDisplay>>
  interrupt?: {
    accept: ClientToolDisplay
    reject: ClientToolDisplay
  }
  /**
   * Optional function to generate dynamic display text based on parameters
   * If provided, this will override the default text in displayNames
   */
  getDynamicText?: DynamicTextFormatter
  /**
   * UI configuration for how this tool renders in the tool-call component.
   * This replaces hardcoded logic in tool-call.tsx with declarative config.
   */
  uiConfig?: ToolUIConfig
}

export class BaseClientTool {
  readonly toolCallId: string
  readonly name: string
  protected state: ClientToolCallState
  protected metadata: BaseClientToolMetadata
  protected isMarkedComplete = false
  protected timeoutMs: number = DEFAULT_TOOL_TIMEOUT_MS

  constructor(toolCallId: string, name: string, metadata: BaseClientToolMetadata) {
    this.toolCallId = toolCallId
    this.name = name
    this.metadata = metadata
    this.state = ClientToolCallState.generating
  }

  /**
   * Set a custom timeout for this tool (in milliseconds)
   */
  setTimeoutMs(ms: number): void {
    this.timeoutMs = ms
  }

  /**
   * Check if this tool has been marked complete
   */
  hasBeenMarkedComplete(): boolean {
    return this.isMarkedComplete
  }

  /**
   * Ensure the tool is marked complete. If not already marked, marks it with error.
   * This should be called in finally blocks to prevent leaked tool calls.
   */
  async ensureMarkedComplete(
    fallbackMessage = 'Tool execution did not complete properly'
  ): Promise<void> {
    if (!this.isMarkedComplete) {
      baseToolLogger.warn('Tool was not marked complete, marking with error', {
        toolCallId: this.toolCallId,
        toolName: this.name,
        state: this.state,
      })
      await this.markToolComplete(500, fallbackMessage)
      this.setState(ClientToolCallState.error)
    }
  }

  /**
   * Execute with timeout protection. Wraps the execution in a timeout and ensures
   * markToolComplete is always called.
   */
  async executeWithTimeout(executeFn: () => Promise<void>, timeoutMs?: number): Promise<void> {
    const timeout = timeoutMs ?? this.timeoutMs
    let timeoutId: NodeJS.Timeout | null = null

    try {
      await Promise.race([
        executeFn(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`Tool execution timed out after ${timeout / 1000} seconds`))
          }, timeout)
        }),
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      baseToolLogger.error('Tool execution failed or timed out', {
        toolCallId: this.toolCallId,
        toolName: this.name,
        error: message,
      })
      // Only mark complete if not already marked
      if (!this.isMarkedComplete) {
        await this.markToolComplete(500, message)
        this.setState(ClientToolCallState.error)
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      // Ensure tool is always marked complete
      await this.ensureMarkedComplete()
    }
  }

  // Intentionally left empty - specific tools can override
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(_args?: Record<string, any>): Promise<void> {
    return
  }

  /**
   * Mark a tool as complete on the server (proxies to server-side route).
   * Once called, the tool is considered complete and won't be marked again.
   */
  async markToolComplete(status: number, message?: any, data?: any): Promise<boolean> {
    // Prevent double-marking
    if (this.isMarkedComplete) {
      baseToolLogger.warn('markToolComplete called but tool already marked complete', {
        toolCallId: this.toolCallId,
        toolName: this.name,
        existingState: this.state,
        attemptedStatus: status,
      })
      return true
    }

    this.isMarkedComplete = true

    try {
      baseToolLogger.info('markToolComplete called', {
        toolCallId: this.toolCallId,
        toolName: this.name,
        state: this.state,
        status,
        hasMessage: message !== undefined,
        hasData: data !== undefined,
      })
    } catch {}

    try {
      const res = await fetch('/api/copilot/tools/mark-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: this.toolCallId,
          name: this.name,
          status,
          message,
          data,
        }),
      })

      if (!res.ok) {
        // Try to surface server error
        let errorText = `Failed to mark tool complete (status ${res.status})`
        try {
          const { error } = await res.json()
          if (error) errorText = String(error)
        } catch {}
        throw new Error(errorText)
      }

      const json = (await res.json()) as { success?: boolean }
      return json?.success === true
    } catch (e) {
      // Default failure path - but tool is still marked complete locally
      baseToolLogger.error('Failed to mark tool complete on server', {
        toolCallId: this.toolCallId,
        error: e instanceof Error ? e.message : String(e),
      })
      return false
    }
  }

  // Accept (continue) for interrupt flows: move pending -> executing
  async handleAccept(): Promise<void> {
    this.setState(ClientToolCallState.executing)
  }

  // Reject (skip) for interrupt flows: mark complete with a standard skip message
  async handleReject(): Promise<void> {
    await this.markToolComplete(200, 'Tool execution was skipped by the user')
    this.setState(ClientToolCallState.rejected)
  }

  // Return the display configuration for the current state
  getDisplayState(): ClientToolDisplay | undefined {
    return this.metadata.displayNames[this.state]
  }

  // Return interrupt display config (labels/icons) if defined
  getInterruptDisplays(): BaseClientToolMetadata['interrupt'] | undefined {
    return this.metadata.interrupt
  }

  // Transition to a new state (also sync to Copilot store)
  setState(next: ClientToolCallState, options?: { result?: any }): void {
    const prev = this.state
    this.state = next

    // Notify store via manager to avoid import cycles
    try {
      const { syncToolState } = require('@/lib/copilot/tools/client/manager')
      syncToolState(this.toolCallId, next, options)
    } catch {}

    // Log transition after syncing
    try {
      baseToolLogger.info('setState transition', {
        toolCallId: this.toolCallId,
        toolName: this.name,
        prev,
        next,
        hasResult: options?.result !== undefined,
      })
    } catch {}
  }

  // Expose current state
  getState(): ClientToolCallState {
    return this.state
  }

  hasInterrupt(): boolean {
    return !!this.metadata.interrupt
  }

  /**
   * Get UI configuration for this tool.
   * Used by tool-call component to determine rendering behavior.
   */
  getUIConfig(): ToolUIConfig | undefined {
    return this.metadata.uiConfig
  }
}
