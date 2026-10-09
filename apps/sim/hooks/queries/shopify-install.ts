import { useMutation, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type CompleteShopifyInstallBody,
  completeShopifyInstallContract,
} from '@/lib/api/contracts/shopify-install'
import { workspaceCredentialKeys } from '@/hooks/queries/utils/credential-keys'

/** Completes the browser-bound Shopify connection and refreshes the workspace credential list. */
export function useCompleteShopifyInstall() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CompleteShopifyInstallBody) =>
      requestJson(completeShopifyInstallContract, { body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workspaceCredentialKeys.lists() }),
  })
}
