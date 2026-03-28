import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AcademyCertificate } from '@/lib/academy/types'
import { fetchJson } from '@/hooks/selectors/helpers'

export const academyKeys = {
  all: ['academy'] as const,
  certificates: () => [...academyKeys.all, 'certificate'] as const,
  certificate: (certificateNumber?: string) =>
    [...academyKeys.certificates(), certificateNumber ?? ''] as const,
}

export function useAcademyCertificate(certificateNumber?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: academyKeys.certificate(certificateNumber),
    queryFn: ({ signal }) =>
      fetchJson<{ certificate: AcademyCertificate }>(
        `/api/academy/certificates?certificateNumber=${encodeURIComponent(certificateNumber as string)}`,
        { signal }
      ).then((d) => d.certificate),
    enabled: (options?.enabled ?? true) && Boolean(certificateNumber),
    staleTime: 10 * 60 * 1000,
  })
}

export function useIssueCertificate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { courseId: string; completedLessonIds: string[] }) =>
      fetchJson<{ certificate: AcademyCertificate }>('/api/academy/certificates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(variables),
      }).then((d) => d.certificate),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: academyKeys.certificates() })
    },
  })
}
