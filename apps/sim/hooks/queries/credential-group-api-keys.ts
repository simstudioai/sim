'use client'

import { useMutation } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { requestJson } from '@/lib/api/client/request'
import {
  deleteCredentialGroupApiKeyContract,
  type SaveCredentialGroupApiKeyBody,
  saveCredentialGroupApiKeyContract,
} from '@/lib/api/contracts/credential-groups'

interface UseCredentialGroupApiKeyProps {
  token: string
  optionId: string
}

export function useSaveCredentialGroupApiKey({ token, optionId }: UseCredentialGroupApiKeyProps) {
  const router = useRouter()
  return useMutation({
    gcTime: 0,
    mutationFn: (body: SaveCredentialGroupApiKeyBody) =>
      requestJson(saveCredentialGroupApiKeyContract, {
        params: { token, optionId },
        body,
      }),
    onSuccess: () => router.refresh(),
  })
}

export function useDeleteCredentialGroupApiKey({ token, optionId }: UseCredentialGroupApiKeyProps) {
  const router = useRouter()
  return useMutation({
    gcTime: 0,
    mutationFn: () =>
      requestJson(deleteCredentialGroupApiKeyContract, { params: { token, optionId } }),
    onSuccess: () => router.refresh(),
  })
}
