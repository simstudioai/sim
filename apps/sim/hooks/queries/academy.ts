import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AcademyCertificate } from '@/lib/academy/types'
import { fetchJson } from '@/hooks/selectors/helpers'

export const academyKeys = {
  all: ['academy'] as const,
  certificates: () => [...academyKeys.all, 'certificate'] as const,
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
