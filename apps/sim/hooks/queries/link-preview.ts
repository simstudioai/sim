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
 * `/api/link-preview` proxy. Mount the consuming component lazily (e.g. inside
 * a tooltip that renders on open) so the request only fires on intent.
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
