'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { PeopleDirectory } from '@/platform/app/(shell)/people/_components/directory/directory'
import { PeopleFrame } from '@/platform/app/(shell)/people/_components/people-page/people-frame'
import { Button, SegmentedControl } from '@/platform/design-system/components'
import { usePeopleUrl } from '@/platform/lib/data/people'

const OrgChart = dynamic(() =>
  import('@/platform/app/(shell)/people/_components/org-chart/org-chart').then(
    (module) => module.OrgChart
  )
)
const ImportModal = dynamic(() =>
  import('@/platform/app/(shell)/people/_components/import/import-modal').then(
    (module) => module.ImportModal
  )
)
const DirectorySyncModal = dynamic(() =>
  import('@/platform/app/(shell)/people/_components/directory-sync/directory-sync-modal').then(
    (module) => module.DirectorySyncModal
  )
)

const VIEWS = [
  { value: 'chart', label: 'Org chart', icon: 'I118' },
  { value: 'directory', label: 'Directory', icon: 'I134' },
] as const

export function PeoplePage() {
  const organization = useOrganizationContext()
  const { isAdmin } = organization.viewer
  const [{ view, search, department, departmentKey, panel }, setView] = usePeopleUrl()
  const [importing, setImporting] = useState(false)
  const openSync = () => void setView({ panel: 'sync' }, { history: 'push' })
  const openImport = () => setImporting(true)
  const currentView = view ?? (search || department || departmentKey ? 'directory' : 'chart')
  return (
    <PeopleFrame
      actions={
        isAdmin ? (
          <>
            <Button onClick={openSync}>Directory sync</Button>
            <Button onClick={openImport}>Import</Button>
          </>
        ) : undefined
      }
    >
      <SegmentedControl
        label='People view'
        options={VIEWS}
        value={currentView}
        onSelect={(next) => void setView({ view: next }, { history: 'push' })}
      />
      {currentView === 'chart' ? (
        <OrgChart
          organization={organization}
          onImport={isAdmin ? openImport : undefined}
          onSync={isAdmin ? openSync : undefined}
        />
      ) : (
        <PeopleDirectory organizationId={organization.organization.id} />
      )}
      {importing && !panel && isAdmin && (
        <ImportModal organization={organization} onClose={() => setImporting(false)} />
      )}
      {panel === 'sync' && isAdmin && (
        <DirectorySyncModal
          key={organization.organization.id}
          organization={organization}
          onClose={() => void setView({ panel: null })}
        />
      )}
    </PeopleFrame>
  )
}
