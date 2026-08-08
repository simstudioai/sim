'use client'

import { useMemo } from 'react'
import { selectRawMountableSecretNames } from '@/lib/credentials/secret-mount-options'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'

export function useRawMountableSecretOptions(workspaceId?: string) {
  const query = useWorkspaceCredentials({ workspaceId })
  const options = useMemo(
    () =>
      selectRawMountableSecretNames(query.data ?? []).map((name) => ({
        value: name,
        label: name,
      })),
    [query.data]
  )

  return { options, isPending: query.isPending }
}
