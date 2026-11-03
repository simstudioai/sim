import { type PeopleSyncConfig, peopleSyncConfigSchema } from '@/lib/api/contracts/people-sync'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { externalDirectoryUsers } from '@/lib/people/provider-import'
import { openEntraReader } from '@/lib/people/sync/entra'
import type { DirectoryReader } from '@/lib/people/sync/types'

export async function openDirectoryReader(
  config: Exclude<PeopleSyncConfig, { source: 'scim' }>
): Promise<DirectoryReader> {
  const parsed = peopleSyncConfigSchema.safeParse(config)
  if (!parsed.success || parsed.data.source === 'scim')
    throw new OrchestrationError(
      'validation',
      'The saved directory settings are invalid. Reconnect the directory.'
    )
  return parsed.data.source === 'entra'
    ? openEntraReader(parsed.data)
    : externalDirectoryUsers(parsed.data)
}
