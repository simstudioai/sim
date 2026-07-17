import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getLinkPreviewContract, type LinkPreviewResponse } from '@/lib/api/contracts/link-preview'

/** Previews are near-immutable page metadata; the server also caches for 24h. */
export const LINK_PREVIEW_STALE_TIME = 60 * 60 * 1000

export const linkPreviewKeys = {
  all: ['link-preview'] as const,
  details: () => [...linkPreviewKeys.all, 'detail'] as const,
  detail: (url?: string) => [...linkPreviewKeys.details(), url ?? ''] as const,
}

async function fetchLinkPreview(url: string, signal?: AbortSignal): Promise<LinkPreviewResponse> {
  return requestJson(getLinkPreviewContract, { query: { url }, signal })
}

/**
 * OG metadata for an external URL, fetched through the SSRF-hardened
 * `/api/link-preview` proxy. Fires when the consuming component renders so the
 * preview is normally cached before the user hovers; results are long-lived
 * (client staleTime + 24h server-side Redis cache) and failures are not
 * retried.
 */
export function useLinkPreview(url?: string) {
  return useQuery({
    queryKey: linkPreviewKeys.detail(url),
    queryFn: ({ signal }) => fetchLinkPreview(url as string, signal),
    enabled: Boolean(url),
    staleTime: LINK_PREVIEW_STALE_TIME,
    retry: false,
  })
}
