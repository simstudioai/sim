'use client'

import { HelpModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/help-modal'
import { SearchModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal'
import type { WorkspaceSidebarServices } from '@/app/workspace/[workspaceId]/w/components/sidebar/use-workspace-sidebar-services'
import { useSearchModalStore } from '@/stores/modals/search/store'

interface WorkspaceSidebarModalsProps {
  services: WorkspaceSidebarServices
}

/**
 * The modals every workspace sidebar mounts: the command palette (`Cmd+K`), the help
 * modal, and the hidden file input the palette's "Import workflow" action clicks. Fed by
 * {@link useWorkspaceSidebarServices} so the workspace sidebar and the project Build
 * sidebar mount one identical set.
 */
export function WorkspaceSidebarModals({ services }: WorkspaceSidebarModalsProps) {
  const isSearchModalOpen = useSearchModalStore((state) => state.isOpen)
  const setIsSearchModalOpen = useSearchModalStore((state) => state.setOpen)

  return (
    <>
      <input
        ref={services.importFileInputRef}
        type='file'
        accept='.json,.zip'
        multiple
        className='hidden'
        onChange={services.handleImportFileChange}
      />

      <SearchModal
        open={isSearchModalOpen}
        onOpenChange={setIsSearchModalOpen}
        workflows={services.searchModal.workflows}
        workspaces={services.searchModal.workspaces}
        chats={services.chats}
        logs={services.searchModal.logs}
        integrations={services.searchModal.integrations}
        connectedAccounts={services.searchModal.connectedAccounts}
        pageContext={services.searchModal.pageContext}
        canEdit={services.canEdit}
        canAdmin={services.canAdmin}
        onCreateWorkflow={services.handleCreateWorkflow}
        onCreateFolder={services.handleCreateFolder}
        onImportWorkflow={services.handleImportWorkflow}
      />

      <HelpModal
        open={services.isHelpModalOpen}
        onOpenChange={services.setIsHelpModalOpen}
        workflowId={services.workflowId}
        workspaceId={services.workspaceId}
      />
    </>
  )
}
