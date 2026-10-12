import { useState } from 'react'
import { Chip, ChipInput, Label, toast } from '@sim/emcn'
import { useSettingsUnsavedGuard } from '@/components/settings/use-settings-unsaved-guard'
import type { Project } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { useRenameProject } from '@/hooks/queries/projects'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'
import { useUserPermissions } from '@/hooks/use-user-permissions'

interface ProjectSettingsProps {
  project: Project
}

/** Project settings use the project API; environment names remain independent. */
export function ProjectGeneralSettings({ project }: ProjectSettingsProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const rename = useRenameProject()
  const permissions = useWorkspacePermissionsQuery(project.rootId)
  const { canAdmin, isLoading } = useUserPermissions(
    permissions.data ?? null,
    permissions.isPending
  )
  const name = draft ?? project.name
  const changed = name.trim() !== project.name
  useSettingsUnsavedGuard({ isDirty: changed, navigationBlocked: rename.isPending })
  return (
    <section className='mx-auto flex w-full max-w-[760px] flex-col gap-6 px-6 py-6'>
      <h2 className='text-[var(--text-primary)] text-xl'>Project settings</h2>
      <form
        className='flex flex-col gap-3'
        onSubmit={(event) => {
          event.preventDefault()
          if (!canAdmin || !changed || !name.trim() || rename.isPending) return
          rename.mutate(
            { projectId: project.projectId, name: name.trim() },
            {
              onSuccess: () => {
                setDraft(null)
                toast.success('Project renamed')
              },
            }
          )
        }}
      >
        <Label htmlFor='project-name'>Project name</Label>
        <ChipInput
          id='project-name'
          value={name}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={100}
          disabled={isLoading || !canAdmin || rename.isPending}
        />
        {!isLoading && !canAdmin && (
          <p className='text-[var(--text-muted)] text-small'>
            A project administrator can change this name.
          </p>
        )}
        {rename.error && (
          <p role='alert' className='text-[var(--text-error)] text-small'>
            {rename.error.message}
          </p>
        )}
        {canAdmin && (
          <div className='flex items-center gap-2'>
            <Chip
              type='submit'
              variant='primary'
              disabled={!changed || !name.trim() || rename.isPending}
            >
              {rename.isPending ? 'Saving…' : 'Save'}
            </Chip>
            {changed && (
              <Chip
                type='button'
                disabled={rename.isPending}
                onClick={() => {
                  setDraft(null)
                  rename.reset()
                }}
              >
                Discard
              </Chip>
            )}
          </div>
        )}
      </form>
    </section>
  )
}
