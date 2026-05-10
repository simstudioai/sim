import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AcademyCertificate } from '@/lib/academy/types'
import { requestJson } from '@/lib/api/client/request'
import { getAcademyCertificateContract, issueAcademyCertificateContract } from '@/lib/api/contracts'

export const academyKeys = {
  all: ['academy'] as const,
  certificates: () => [...academyKeys.all, 'certificate'] as const,
  certificate: (courseId: string) => [...academyKeys.certificates(), courseId] as const,
}

async function fetchCourseCertificate(
  courseId: string,
  signal: AbortSignal
): Promise<AcademyCertificate | null> {
  const data = await requestJson(getAcademyCertificateContract, {
    query: { courseId },
    signal,
  })
  return data.certificate
}

export function useCourseCertificate(courseId?: string) {
  return useQuery({
    queryKey: academyKeys.certificate(courseId ?? ''),
    queryFn: ({ signal }) => fetchCourseCertificate(courseId as string, signal),
    enabled: Boolean(courseId),
    staleTime: 60 * 1000,
  })
}

export function useIssueCertificate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { courseId: string; completedLessonIds: string[] }) =>
      requestJson(issueAcademyCertificateContract, { body: variables }).then((d) => d.certificate),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: academyKeys.certificate(variables.courseId) })
    },
  })
}
