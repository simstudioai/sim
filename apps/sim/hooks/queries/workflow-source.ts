import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import { type QueryClient, type QueryFunctionContext, useQuery } from '@tanstack/react-query'
import { requestJsonRevalidated } from '@/lib/api/client/request'
import { getWorkflowSourceContract, type WorkflowSource } from '@/lib/api/contracts/workflow-source'

/** The Code tab invalidates after every persisted edit, so staleness only covers idle refocus. */
const WORKFLOW_SOURCE_STALE_TIME = 30_000

export const workflowSourceKeys = {
  all: ['workflow-source'] as const,
  details: () => [...workflowSourceKeys.all, 'detail'] as const,
  detail: (workflowId?: string) => [...workflowSourceKeys.details(), workflowId ?? ''] as const,
}

/** A cached source read with the `ETag` it came with, so a refetch can revalidate it. */
interface CachedWorkflowSource {
  source: WorkflowSource
  etag: string | null
}

type WorkflowSourceKey = ReturnType<typeof workflowSourceKeys.detail>

/**
 * Reads the workflow's source, revalidating the cached copy by its `ETag`: an unchanged draft
 * answers `304` and the cached copy is kept, so nothing is transferred. The workflow id is the
 * key's last part, so the read and its cache entry never disagree.
 */
async function fetchWorkflowSource({
  client,
  queryKey,
  signal,
}: QueryFunctionContext<WorkflowSourceKey>): Promise<CachedWorkflowSource> {
  const cached = client.getQueryData<CachedWorkflowSource>(queryKey)
  const read = await requestJsonRevalidated(
    getWorkflowSourceContract,
    { params: { id: queryKey[2] }, query: { functionCode: 'inline' }, signal },
    cached?.etag
  )
  if (read.notModified && cached) return cached
  if (read.notModified) throw new Error('A workflow source revalidation had no cached copy')
  return { source: read.body.data, etag: read.etag }
}

const selectEntryText = ({ source }: CachedWorkflowSource) => source.files[SOURCE_ENTRY_FILE] ?? ''

/**
 * The text of the workflow's draft printed as one TypeScript file (function code inline), for
 * display. Only the entry file is selected, so a refetch that prints the same text re-renders
 * nothing; a refetch of an unchanged draft revalidates by `ETag` and transfers no body.
 */
export function useWorkflowSourceText(workflowId?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: workflowSourceKeys.detail(workflowId),
    queryFn: fetchWorkflowSource,
    enabled: Boolean(workflowId) && (options?.enabled ?? true),
    staleTime: WORKFLOW_SOURCE_STALE_TIME,
    select: selectEntryText,
  })
}

/**
 * The draft's entry file text for a download. It revalidates the cached copy by `ETag` first
 * (a `304` when nothing changed), so an edit made since the Code tab last read is never missed.
 */
export async function fetchWorkflowSourceText(
  queryClient: QueryClient,
  workflowId: string
): Promise<string> {
  const read = await queryClient.fetchQuery({
    queryKey: workflowSourceKeys.detail(workflowId),
    queryFn: fetchWorkflowSource,
    staleTime: 0,
  })
  return selectEntryText(read)
}
