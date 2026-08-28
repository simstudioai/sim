import { requestAzureDataExplorer } from '@/lib/internal/azure-data-explorer/client'
import type { AzureDataExplorerInput } from '@/lib/internal/azure-data-explorer/schema'

export async function executeAzureDataExplorerOperation(
  input: AzureDataExplorerInput,
  requestId: string,
  signal?: AbortSignal
) {
  return requestAzureDataExplorer(input, requestId, signal)
}
