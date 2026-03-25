import { createLogger } from '@sim/logger'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AcademyCertificate } from '@/lib/academy/types'

const logger = createLogger('AcademyQueries')

// ─── Query Keys ───────────────────────────────────────────────────────────────

export const academyKeys = {
  all: ['academy'] as const,
  certificates: () => [...academyKeys.all, 'certificate'] as const,
  certificate: (certificateNumber?: string) =>
    [...academyKeys.certificates(), certificateNumber ?? ''] as const,
}

// ─── Fetch Helpers ────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? `Request failed: ${res.status}`)
  }
  return res.json() as T
}

// ─── Query Hooks ──────────────────────────────────────────────────────────────

export function useAcademyCertificate(certificateNumber?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: academyKeys.certificate(certificateNumber),
    queryFn: ({ signal }) =>
      apiFetch<{ certificate: AcademyCertificate }>(
        `/api/academy/certificates?certificateNumber=${encodeURIComponent(certificateNumber as string)}`,
        { signal }
      ).then((d) => d.certificate),
    enabled: (options?.enabled ?? true) && Boolean(certificateNumber),
    staleTime: 10 * 60 * 1000,
  })
}

// ─── Mutation Hooks ───────────────────────────────────────────────────────────

export function useIssueCertificate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (courseId: string) =>
      apiFetch<{ certificate: AcademyCertificate }>('/api/academy/certificates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId }),
      }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: academyKeys.certificates() })
    },
    onError: (error) => {
      logger.error('Failed to issue certificate', { error })
    },
  })
}
