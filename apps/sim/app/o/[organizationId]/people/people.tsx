'use client'

import { useState } from 'react'
import { ChipSwitch } from '@sim/emcn'
import { List, RefreshCw, Users, Workflow } from '@sim/emcn/icons'
import dynamic from 'next/dynamic'
import { useQueryStates } from 'nuqs'
import { IMPORT_PEOPLE_ACTION } from '@/app/o/[organizationId]/people/columns'
import { PeopleDirectory } from '@/app/o/[organizationId]/people/people-directory'
import { PeopleImportModal } from '@/app/o/[organizationId]/people/people-import-modal'
import { peopleParsers, peopleUrlKeys } from '@/app/o/[organizationId]/people/search-params'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { Resource } from '@/app/workspace/[workspaceId]/components/resource/resource'

const PeopleChart = dynamic(() =>
  import('@/app/o/[organizationId]/people/people-chart').then((module) => module.PeopleChart)
)
const DirectorySyncModal = dynamic(() =>
  import('@/app/o/[organizationId]/people/directory-sync-modal').then(
    (module) => module.DirectorySyncModal
  )
)
const VIEWS = [
  { value: 'chart', label: 'Org chart', icon: Workflow },
  { value: 'directory', label: 'Directory', icon: List },
] as const

interface PeopleProps {
  organizationId: string
}

export function People({ organizationId }: PeopleProps) {
  const { viewer } = useOrganizationContext()
  const [{ view, search, department, departmentKey, panel }, setView] = useQueryStates(
    peopleParsers,
    peopleUrlKeys
  )
  const [importOpen, setImportOpen] = useState(false)
  const openSync = () => void setView({ panel: 'sync' }, { history: 'push' })
  const currentView = view ?? (search || department || departmentKey ? 'directory' : 'chart')

  const viewSwitch = (
    <ChipSwitch
      aria-label='People view'
      value={currentView}
      options={VIEWS}
      onChange={(next) => void setView({ view: next }, { history: 'push' })}
    />
  )

  return (
    <Resource>
      <Resource.Header
        icon={Users}
        title='People'
        actions={
          viewer.isAdmin
            ? [
                {
                  id: 'sync',
                  text: 'Directory sync',
                  icon: RefreshCw,
                  onSelect: openSync,
                },
                {
                  ...IMPORT_PEOPLE_ACTION,
                  id: 'import',
                  onSelect: () => setImportOpen(true),
                },
              ]
            : []
        }
      />
      {currentView === 'chart' ? (
        <PeopleChart
          organizationId={organizationId}
          viewSwitch={viewSwitch}
          onImport={viewer.isAdmin ? () => setImportOpen(true) : undefined}
          onSync={viewer.isAdmin ? openSync : undefined}
        />
      ) : (
        <>
          <div className='flex shrink-0 px-4 py-2'>{viewSwitch}</div>
          <PeopleDirectory organizationId={organizationId} />
        </>
      )}
      {importOpen && !panel && viewer.isAdmin && (
        <PeopleImportModal organizationId={organizationId} onClose={() => setImportOpen(false)} />
      )}
      {panel === 'sync' && viewer.isAdmin && (
        <DirectorySyncModal
          key={organizationId}
          organizationId={organizationId}
          onClose={() => void setView({ panel: null })}
        />
      )}
    </Resource>
  )
}
