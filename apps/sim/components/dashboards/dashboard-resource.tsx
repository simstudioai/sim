'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { ChartColumn, Loader, Trash } from '@sim/emcn/icons'
import { DashboardFeatureGate } from '@/components/dashboards/dashboard-feature-gate'
import { DashboardPreview } from '@/components/dashboards/dashboard-preview'
import { EmptyState } from '@/components/empty-state/empty-state'
import { Resource } from '@/app/workspace/[workspaceId]/components/resource/resource'
import { useWorkspaceFilesRoom } from '@/app/workspace/[workspaceId]/files/hooks/use-workspace-files-room'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useDeleteWorkspaceDashboard, useWorkspaceDashboard } from '@/hooks/queries/dashboards'

interface DashboardResourceProps {
  workspaceId: string
  /** The Chat resource panel supplies its own chrome; the page renders the header and actions. */
  embedded?: boolean
}

/** The workspace's single dashboard, or an empty state until Sim saves the first one. */
export function DashboardResource(props: DashboardResourceProps) {
  return (
    <DashboardFeatureGate>
      <EnabledDashboardResource {...props} />
    </DashboardFeatureGate>
  )
}

function EnabledDashboardResource({ workspaceId, embedded }: DashboardResourceProps) {
  useWorkspaceFilesRoom(workspaceId)
  const { canEdit } = useUserPermissionsContext()
  const query = useWorkspaceDashboard(workspaceId)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const dashboard = query.data?.dashboard ?? null
  return (
    <Resource>
      {!embedded && (
        <Resource.Header
          icon={ChartColumn}
          title='Dashboard'
          actions={
            dashboard && canEdit
              ? [
                  {
                    id: 'delete',
                    icon: Trash,
                    text: 'Delete',
                    variant: 'destructive',
                    onSelect: () => setConfirmingDelete(true),
                  },
                ]
              : []
          }
        />
      )}
      {query.isPending ? (
        <div role='status' className='flex flex-1 items-center justify-center'>
          <Loader animate className='size-[16px] text-[var(--text-icon)]' />
          <span className='sr-only'>Loading dashboard</span>
        </div>
      ) : query.error ? (
        <div className='p-6 text-[var(--text-error)]' role='alert'>
          {query.error.message}
        </div>
      ) : dashboard && query.data.content !== null ? (
        <div className='min-h-0 flex-1 overflow-auto p-6'>
          <DashboardPreview
            workspaceId={workspaceId}
            fileId={dashboard.id}
            content={query.data.content}
          />
        </div>
      ) : (
        <EmptyState
          title='Dashboard'
          description='Sim will build your dashboard here once your workspace is set up.'
        />
      )}
      {confirmingDelete && (
        <DeleteDashboardModal
          workspaceId={workspaceId}
          onClose={() => setConfirmingDelete(false)}
        />
      )}
    </Resource>
  )
}

interface DeleteDashboardModalProps {
  workspaceId: string
  onClose: () => void
}

function DeleteDashboardModal({ workspaceId, onClose }: DeleteDashboardModalProps) {
  const remove = useDeleteWorkspaceDashboard(workspaceId)
  return (
    <ChipModal
      size='sm'
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      srTitle='Delete dashboard'
    >
      <ChipModalHeader onClose={onClose}>Delete dashboard</ChipModalHeader>
      <ChipModalBody>
        <p className='px-2 text-[var(--text-secondary)]'>Delete this workspace’s dashboard?</p>
        {remove.error && <ChipModalError>{remove.error.message}</ChipModalError>}
      </ChipModalBody>
      <ChipModalFooter
        defaultAction='dismiss'
        onCancel={onClose}
        primaryAction={{
          label: 'Delete',
          variant: 'destructive',
          disabled: remove.isPending,
          onClick: () => remove.mutate(undefined, { onSuccess: onClose }),
        }}
      />
    </ChipModal>
  )
}
