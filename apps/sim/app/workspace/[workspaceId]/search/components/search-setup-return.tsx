'use client'

import { Chip } from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { searchSetupReturnHref } from '@/lib/sim-search/setup-navigation'
import { searchSetupReturnParam } from '@/app/workspace/[workspaceId]/search/search-params'

interface SearchSetupReturnProps {
  workspaceId: string
  onNavigate?: (navigate: () => void) => void
}

/** Rejoins the original source setup from integrations or connected-account settings. */
export function SearchSetupReturn({ workspaceId, onNavigate }: SearchSetupReturnProps) {
  const [source] = useQueryState(searchSetupReturnParam.key, searchSetupReturnParam.parser)
  const router = useRouter()
  if (!source) return null
  const navigate = () => router.push(searchSetupReturnHref(workspaceId, source))
  return (
    <Chip
      className='self-start'
      leftIcon={ArrowLeft}
      onClick={() => (onNavigate ? onNavigate(navigate) : navigate())}
    >
      Continue Search setup
    </Chip>
  )
}
