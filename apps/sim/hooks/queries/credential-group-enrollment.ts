'use client'

import { useMutation } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { submitCredentialGroupApiKeyContract } from '@/lib/api/contracts/credential-groups'

/**
 * Submits one API key from the public enrollment page.
 *
 * No query keys or invalidation: the page is a server component holding no client cache, so
 * the caller re-renders it with `router.refresh()` after a successful submit.
 */
export function useSubmitCredentialGroupApiKey(token: string, optionId: string) {
  return useMutation<{ connectedOptionId: string }, Error, { fields: Record<string, string> }>({
    mutationFn: ({ fields }) =>
      requestJson(submitCredentialGroupApiKeyContract, {
        params: { token, optionId },
        body: { fields },
      }),
  })
}
