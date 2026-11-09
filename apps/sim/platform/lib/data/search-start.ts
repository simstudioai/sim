'use client'

import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth/client'
import { useRecordSearchHistory } from '@/hooks/queries/search-history'
import { useOrganization } from '@/platform/lib/data/organization'
import { surfaceHref } from '@/platform/lib/data/organization-model'

/** Home's Search entry: a submitted query, recorded as Search's own field records one. */
export function useStartSearch(): ((query: string) => void) | null {
  const organization = useOrganization()
  const organizationId = organization.organization.id
  const { data: session } = useSession()
  const record = useRecordSearchHistory(organizationId, session?.user?.id)
  const router = useRouter()
  if (!organization.searchAccess.memberScoped) return null
  return (query) => {
    record.mutate({ kind: 'query', query })
    router.push(`${surfaceHref(organization, '/search')}?${new URLSearchParams({ q: query })}`)
  }
}
