import type { OutputCondition, SubBlockConfig } from '@/blocks/types'

export interface TriggerOutput {
  type?: string
  description?: string | TriggerOutput
  /** Restricts which trigger configurations surface this output in the tag dropdown. */
  condition?: OutputCondition
  [key: string]: TriggerOutput | OutputCondition | string | undefined
}

export interface TriggerConfig {
  id: string
  name: string
  provider: string
  description: string
  version: string

  icon?: React.ComponentType<{ className?: string }>

  subBlocks: SubBlockConfig[]

  // Define the structure of data this trigger outputs to workflows
  outputs: Record<string, TriggerOutput>

  // Webhook configuration (for most triggers)
  webhook?: {
    method?: 'POST' | 'GET' | 'PUT' | 'DELETE'
    headers?: Record<string, string>
  }

  /** When true, this trigger is poll-based (cron-driven) rather than push-based. */
  polling?: boolean

  /**
   * When true, the trigger stays registered so existing workflows keep
   * resolving, but it is excluded from generated documentation. Used for
   * triggers superseded by a newer version (e.g. Grain view-scoped triggers
   * after the v1 API sunset).
   */
  deprecated?: boolean
}

export interface TriggerRegistry {
  [triggerId: string]: TriggerConfig
}

interface TriggerInstance {
  id: string
  triggerId: string
  blockId: string
  workflowId: string
  config: Record<string, any>
  webhookPath?: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}
