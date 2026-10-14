'use client'

import { useRouter } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import { CreateWorkspaceModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/create-workspace-modal/create-workspace-modal'
import { useCreateProject } from '@/hooks/queries/projects'
import { useWorkspaceCreationPolicy } from '@/hooks/queries/workspace'

/** Whether the viewer may create a project in this organization, and why not. */
export function useProjectCreationPolicy(organizationId: string) {
  const { data: policy } = useWorkspaceCreationPolicy()
  const canCreate = Boolean(policy?.canCreate && policy.organizationId === organizationId)
  return {
    canCreate,
    disabledReason: canCreate ? null : (policy?.reason ?? 'Project creation is unavailable.'),
  }
}

interface CreateProjectModalProps {
  organizationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Names a new project, creates it, and opens its pane on organization Home. */
export function CreateProjectModal({
  organizationId,
  open,
  onOpenChange,
}: CreateProjectModalProps) {
  const router = useRouter()
  const { mutateAsync: createProject, isPending } = useCreateProject()
  return (
    <CreateWorkspaceModal
      resource='project'
      open={open}
      onOpenChange={onOpenChange}
      isCreating={isPending}
      onConfirm={async (name) => {
        const { initialEnvironment } = await createProject({ organizationId, name })
        onOpenChange(false)
        router.push(
          `${organizationRoutes(organizationId).home}?project=${encodeURIComponent(initialEnvironment.id)}&pane=project`
        )
      }}
    />
  )
}
