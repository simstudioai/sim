import { AsyncLocalStorage } from 'node:async_hooks'
import type { RowData } from '@/lib/table/types'
import type { ResolvedSecretTraceProvenanceV1 } from '@/executor/utils/resolved-secret-trace-registry'

/** What a use case returns beside its rows that the rows' provenance does not cover. */
export interface TableRowDeliveryExtras {
  /**
   * The result carries run-state or enrichment error text (`error`, `blockErrors`,
   * cascade provider errors). That text is captured from executor output, which can
   * contain resolved secret plaintext, and no provenance is persisted with it.
   */
  unprovenancedErrorText: boolean
}

type TableRowDeliveryObserver = (
  provenance: ResolvedSecretTraceProvenanceV1,
  values: RowData[],
  extras: TableRowDeliveryExtras
) => Promise<void>

const observer = new AsyncLocalStorage<TableRowDeliveryObserver>()

/** Internal transport evidence observes the persisted provenance of returned rows without changing public API admission or output. */
export function observeTableRowDelivery<T>(observe: TableRowDeliveryObserver, execute: () => T): T {
  return observer.run(observe, execute)
}

/** Whether the current call has a transport observing returned rows, so use cases read provenance for it. */
export function hasTableRowDeliveryObserver(): boolean {
  return observer.getStore() !== undefined
}

/** Runs before the canonical use case returns row data to its transport. */
export async function reportTableRowDelivery(
  provenance: ResolvedSecretTraceProvenanceV1,
  values: RowData[],
  extras: TableRowDeliveryExtras = { unprovenancedErrorText: false }
): Promise<void> {
  await observer.getStore()?.(provenance, values, extras)
}
