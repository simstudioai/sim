import type { LucideIcon } from 'lucide-react'

// Client tool call states used by the new runtime
export enum ClientToolCallState {
  generating = 'generating',
  pending = 'pending',
  executing = 'executing',
  aborted = 'aborted',
  workflow_accepted = 'workflow_accepted',
  workflow_rejected = 'workflow_rejected',
  success = 'success',
  error = 'error',
}

// Display configuration for a given state
export interface ClientToolDisplay {
  text: string
  icon: LucideIcon
}

export interface BaseClientToolMetadata {
  displayNames: Partial<Record<ClientToolCallState, ClientToolDisplay>>
  interrupt?: {
    accept: ClientToolDisplay
    reject: ClientToolDisplay
  }
}

export class BaseClientTool {
  readonly toolCallId: string
  readonly name: string
  protected state: ClientToolCallState
  protected metadata: BaseClientToolMetadata

  constructor(toolCallId: string, name: string, metadata: BaseClientToolMetadata) {
    this.toolCallId = toolCallId
    this.name = name
    this.metadata = metadata
    this.state = ClientToolCallState.generating
  }

  // Intentionally left empty - specific tools can override
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(_args?: Record<string, any>): Promise<void> {
    return
  }

  // Mark a tool as complete on the server (proxies to server-side route)
  async markToolComplete(status: number, message?: any, data?: any): Promise<boolean> {
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
      // Default failure path
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
    this.setState(ClientToolCallState.workflow_rejected)
  }

  // Return the display configuration for the current state
  getDisplayState(): ClientToolDisplay | undefined {
    return this.metadata.displayNames[this.state]
  }

  // Return interrupt display config (labels/icons) if defined
  getInterruptDisplays(): BaseClientToolMetadata['interrupt'] | undefined {
    return this.metadata.interrupt
  }

  // Transition to a new state
  setState(next: ClientToolCallState): void {
    this.state = next
  }

  // Expose current state
  getState(): ClientToolCallState {
    return this.state
  }
}
