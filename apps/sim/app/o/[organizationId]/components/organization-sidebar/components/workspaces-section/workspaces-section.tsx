'use client'

import { useState } from 'react'
import { Button, cn, Tooltip } from '@sim/emcn'
import { Plus, Workspaces } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { WorkspaceList } from '@/app/o/[organizationId]/components/organization-sidebar/components/workspaces-section/workspace-list'
import {
  CollapsedSidebarMenu,
  SidebarSection,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components'
import { CreateWorkspaceModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/create-workspace-modal/create-workspace-modal'
import { SIDEBAR_ITEM_GAP_CLASS } from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { useHoverMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-hover-menu'
import { useCreateWorkspace, useWorkspaceCreationPolicy } from '@/hooks/queries/workspace'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

interface WorkspacesSectionProps {
  organizationId: string
  isCollapsed: boolean
  pathname: string | null
}

export function WorkspacesSection({
  organizationId,
  isCollapsed,
  pathname,
}: WorkspacesSectionProps) {
  const router = useRouter()
  const hover = useHoverMenu()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const { data: creationPolicy } = useWorkspaceCreationPolicy()
  const { mutateAsync: createWorkspace, isPending: isCreating } = useCreateWorkspace()
  const canCreate = creationPolicy?.canCreate && creationPolicy.organizationId === organizationId
  const createDisabledReason = creationPolicy?.reason ?? 'Workspace creation is unavailable.'

  const openCreate = () => {
    if (!canCreate || isCreating) return
    useSettingsDirtyStore.getState().requestLeave(() => {
      hover.close()
      setIsCreateOpen(true)
    })
  }

  return (
    <>
      <SidebarSection
        title='Workspaces'
        railCollapsed={isCollapsed}
        className='shrink-0'
        action={
          !isCollapsed && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='quiet'
                  size='icon'
                  aria-label='New workspace'
                  disabled={!canCreate || isCreating}
                  onClick={openCreate}
                >
                  <Plus className='size-[16px]' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>
                {canCreate ? 'New workspace' : createDisabledReason}
              </Tooltip.Content>
            </Tooltip.Root>
          )
        }
      >
        {isCollapsed ? (
          <div className='px-2'>
            <CollapsedSidebarMenu
              icon={<Workspaces className='size-[16px] shrink-0 text-[var(--text-icon)]' />}
              hover={hover}
              ariaLabel='Workspaces'
              primaryAction={
                canCreate ? { label: 'New workspace', onSelect: openCreate } : undefined
              }
            >
              <WorkspaceList organizationId={organizationId} pathname={pathname} flyout={hover} />
            </CollapsedSidebarMenu>
          </div>
        ) : (
          <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
            <WorkspaceList organizationId={organizationId} pathname={pathname} />
          </div>
        )}
      </SidebarSection>
      <CreateWorkspaceModal
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        isCreating={isCreating}
        onConfirm={async (name) => {
          if (!canCreate) throw new Error(createDisabledReason)
          const workspace = await createWorkspace({ name })
          setIsCreateOpen(false)
          router.push(`/workspace/${workspace.id}`)
        }}
      />
    </>
  )
}
