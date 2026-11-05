'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { PeopleDirectory } from '@/platform/app/(shell)/people/_components/directory/directory'
import { PeopleFrame } from '@/platform/app/(shell)/people/_components/people-page/people-frame'
import styles from '@/platform/app/(shell)/people/_components/people-page/people-page.module.css'
import { Button } from '@/platform/design-system/components'
import {
  type SyncSource,
  useChartRoots,
  useDirectorySyncStatus,
  usePeopleUrl,
  usePeopleViewer,
} from '@/platform/lib/data/people'
import { formatRelativeTime } from '@/platform/lib/time'

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
const DirectorySyncPage = dynamic(() =>
  import('@/platform/app/(shell)/people/_components/directory-sync/directory-sync-page').then(
    (module) => module.DirectorySyncPage
  )
)
const ConnectModal = dynamic(() =>
  import('@/platform/app/(shell)/people/_components/directory-sync/connect-modal').then(
    (module) => module.ConnectModal
  )
)

interface PeoplePageProps {
  organizationId: string
}

export function PeoplePage({ organizationId }: PeoplePageProps) {
  const { isAdmin } = usePeopleViewer()
  const [{ view, search, department, departmentKey, panel }, setView] = usePeopleUrl()
  const [importing, setImporting] = useState(false)
  const [connecting, setConnecting] = useState<SyncSource | null>(null)
  const currentView = view ?? (search || department || departmentKey ? 'directory' : 'chart')
  const status = useDirectorySyncStatus(organizationId, isAdmin)
  const { emptyOrganization } = useChartRoots(organizationId, isAdmin && currentView === 'chart')
  const openSync = () => void setView({ panel: 'sync' }, { history: 'push' })
  const openImport = () => setImporting(true)
  const firstUse = isAdmin && emptyOrganization && status.loaded && !status.sync
  const lastSuccessAt = status.sync?.lastSuccessAt
  const modals = (
    <>
      {importing && isAdmin && (
        <ImportModal
          organizationId={organizationId}
          onClose={() => setImporting(false)}
          onOpenSync={() => {
            setImporting(false)
            openSync()
          }}
        />
      )}
      {connecting && isAdmin && (
        <ConnectModal
          organizationId={organizationId}
          source={connecting}
          onClose={() => setConnecting(null)}
          onConnected={() => {
            setConnecting(null)
            openSync()
          }}
        />
      )}
    </>
  )

  if (panel === 'sync' && isAdmin)
    return (
      <>
        <DirectorySyncPage
          organizationId={organizationId}
          onBack={() => void setView({ panel: null }, { history: 'push' })}
          onConnect={setConnecting}
          onImport={openImport}
        />
        {modals}
      </>
    )

  return (
    <PeopleFrame
      view={currentView}
      onViewChange={(next) => void setView({ view: next }, { history: 'push' })}
      actions={
        isAdmin && !(firstUse && currentView === 'chart') ? (
          <>
            {lastSuccessAt && (
              <span className={styles.updated} data-type='T050'>
                Updated {formatRelativeTime(Date.parse(lastSuccessAt), Date.now())}
              </span>
            )}
            <Button icon='I065' onClick={openSync}>
              Directory sync
            </Button>
            <Button icon='I117' onClick={openImport}>
              Import
            </Button>
          </>
        ) : undefined
      }
    >
      {currentView === 'chart' ? (
        <OrgChart
          organizationId={organizationId}
          firstUse={firstUse}
          onConnect={setConnecting}
          onImport={openImport}
          onSync={isAdmin ? openSync : undefined}
        />
      ) : (
        <PeopleDirectory organizationId={organizationId} />
      )}
      {modals}
    </PeopleFrame>
  )
}
