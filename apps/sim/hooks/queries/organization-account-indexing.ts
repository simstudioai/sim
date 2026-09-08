'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type UpdateOrganizationAccountIndexingBody,
  updateOrganizationAccountIndexingContract,
} from '@/lib/api/contracts/organization-accounts'
import { connectorKeys, searchSourceKeys } from '@/hooks/queries/kb/connectors'
import { organizationAccountsKeys } from '@/hooks/queries/organization-accounts'

export function useUpdateOrganizationAccountIndexing() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      organizationId,
      ...body
    }: { organizationId: string } & UpdateOrganizationAccountIndexingBody) =>
      requestJson(updateOrganizationAccountIndexingContract, {
        params: { id: organizationId },
        body,
      }),
    onSettled: (data, _error, { organizationId }) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: organizationAccountsKeys.detail(organizationId),
        }),
        queryClient.invalidateQueries({
          queryKey: searchSourceKeys.list({ kind: 'organization', organizationId }),
        }),
        ...(data?.knowledgeBaseIds ?? []).map((id) =>
          queryClient.invalidateQueries({ queryKey: connectorKeys.all(id) })
        ),
      ]),
  })
}
