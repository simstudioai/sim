import type { ExternalListingFailures } from '@/connectors/types'

export type ConnectorPartitionWorkKind = 'content' | 'permissions'
type ListingFailure = ExternalListingFailures['samples'][number]

/** Provider adapters validate their own context; persistence owns only partition progress. */
export interface ConnectorPartitionWorkItem<Context> {
  partitionKey: string
  context: Context
  kind: ConnectorPartitionWorkKind
  cursor?: string
  attempts: number
  hasFailure: boolean
  /** This kind's retained failure, whose `since` carries a standing condition's first observation. */
  failure?: ListingFailure
  permissionStartedAt?: Date
}

export interface ConnectorPartitionWorkUpdate {
  partitionKey: string
  kind: ConnectorPartitionWorkKind
  cursor: string | null
  completed: boolean
  retryAt: Date
  attempts: number
  failure: ListingFailure | null
  permissionStartedAt?: Date | null
}

/** All writes are supplied to the caller's lease-guarded checkpoint transaction. */
export interface ConnectorPartitionWorkChanges {
  enqueue?: { partitionKey: string; context: Record<string, unknown>; cursor?: string }[]
  pin?: {
    partitionKey: string
    kind: ConnectorPartitionWorkKind
    cursor: string
    permissionStartedAt?: Date
  }
  update?: ConnectorPartitionWorkUpdate
}

export interface ConnectorPartitionWorkStore<Context> {
  get: (
    partitionKey: string,
    kind: ConnectorPartitionWorkKind
  ) => Promise<ConnectorPartitionWorkItem<Context> | null>
  next: (
    kind: ConnectorPartitionWorkKind,
    now: Date
  ) => Promise<ConnectorPartitionWorkItem<Context> | null>
  remaining: () => Promise<{
    count: number
    retryAt: Date | null
    failures?: ExternalListingFailures
  }>
}
