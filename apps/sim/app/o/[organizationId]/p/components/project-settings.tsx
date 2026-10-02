import { Suspense } from 'react'
import { Chip, ChipConfirmModal, ChipDropdown, Skeleton } from '@sim/emcn'
import { parseAsString, useQueryState, useQueryStates } from 'nuqs'
import {
  getSettingsPermissionConfigKey,
  toSettingsHeaderMeta,
  WORKSPACE_SETTINGS_ITEMS,
} from '@/components/settings/navigation'
import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { ProjectGeneralSettings } from '@/app/o/[organizationId]/p/components/project-general-settings'
import type { Project } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { useMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import { SettingsPage } from '@/app/workspace/[workspaceId]/settings/[section]/settings'
import type { DeletedResource } from '@/app/workspace/[workspaceId]/settings/components/recently-deleted/recently-deleted'
import { SecretDetail } from '@/app/workspace/[workspaceId]/settings/secrets/[credentialId]/secret-detail'
import { PermissionAccessBoundary } from '@/ee/access-requests/components/permission-access-boundary'
import { useWorkspaceSettingsNavigation } from '@/hooks/queries/workspace-settings'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

interface ProjectSettingsProps {
  project: Project
  onBrowse?: () => void
}

/** Existing environment settings, gated by the same server policy as their routed pages. */
export function ProjectSettings({ project, onBrowse }: ProjectSettingsProps) {
  const [section, setSection] = useQueryState(
    'setting',
    parseAsString.withDefault('general').withOptions({ history: 'push' })
  )
  const [credentialId] = useQueryState('credential', parseAsString)
  const [, clearDetail] = useQueryStates({
    search: parseAsString,
    mcpServerId: parseAsString,
    'server-id': parseAsString,
    'custom-tool-id': parseAsString,
    'custom-block-id': parseAsString,
    sandboxId: parseAsString,
    credential: parseAsString,
    'secret-view': parseAsString,
    'usage-tab': parseAsString,
  })
  const { addResource } = useMothershipResources()
  const openResource = (resource: DeletedResource) => {
    const type =
      resource.type === 'knowledge'
        ? 'knowledgebase'
        : resource.type === 'workspace_folder'
          ? 'filefolder'
          : resource.type
    if (type === 'knowledge_folder' || type === 'table_folder' || type === 'chat') {
      onBrowse?.()
      return
    }
    addResource({ id: resource.id, title: resource.name, workspaceId: resource.workspaceId, type })
  }
  const access = useWorkspaceSettingsNavigation(project.id)
  const requestLeave = useSettingsDirtyStore((state) => state.requestLeave)
  const pendingLeave = useSettingsDirtyStore((state) => state.pendingLeave)
  const confirmLeave = useSettingsDirtyStore((state) => state.confirmLeave)
  const cancelLeave = useSettingsDirtyStore((state) => state.cancelLeave)
  const items = WORKSPACE_SETTINGS_ITEMS.filter(
    (item) =>
      item.id !== 'self-host' &&
      item.id !== 'forks' &&
      access.data?.sections.some((entry) => entry.id === item.id)
  )
  const selected = items.find((item) => item.id === section)
  const entry = access.data?.sections.find((item) => item.id === section)
  const unifiedSection = selected?.id === 'api-keys' ? 'apikeys' : selected?.id
  const configKey = unifiedSection && getSettingsPermissionConfigKey(unifiedSection)
  const navigate = (next: string) =>
    requestLeave(() => {
      void clearDetail({
        search: null,
        mcpServerId: null,
        'server-id': null,
        'custom-tool-id': null,
        'custom-block-id': null,
        sandboxId: null,
        credential: null,
        'secret-view': null,
        'usage-tab': null,
      })
      void setSection(next)
    })
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <nav aria-label='Project settings' className='flex shrink-0 items-center gap-2 px-6 py-3'>
        <span className='text-[var(--text-muted)] text-small'>Settings</span>
        <ChipDropdown
          aria-label='Settings section'
          value={section}
          onChange={navigate}
          matchTriggerWidth={false}
          options={[
            { value: 'general', label: 'General' },
            ...items.map((item) => ({ value: item.id, label: item.label, icon: item.icon })),
          ]}
        />
      </nav>
      <div className='min-h-0 flex-1'>
        <Suspense fallback={<Skeleton className='m-6 h-32' />}>
          {section === 'general' ? (
            <ProjectGeneralSettings project={project} />
          ) : access.isPending ? (
            <Skeleton className='m-6 h-32' />
          ) : access.error ? (
            <div role='alert' className='p-6 text-small'>
              <p>{access.error.message}</p>
              <Chip onClick={() => void access.refetch()}>Try again</Chip>
            </div>
          ) : !selected || !unifiedSection ? (
            <p className='p-6 text-[var(--text-muted)] text-small'>
              These settings are unavailable for this environment.
            </p>
          ) : (
            <SettingsHeaderProvider key={`${project.id}:${section}`}>
              {entry?.access === 'allowed' && selected.id === 'secrets' && credentialId ? (
                <SecretDetail workspaceId={project.id} credentialId={credentialId} />
              ) : (
                <SettingsHeaderShell meta={toSettingsHeaderMeta(selected)}>
                  {entry?.access === 'allowed' ? (
                    <SettingsPage
                      section={unifiedSection}
                      resourceChats={false}
                      onViewResource={openResource}
                    />
                  ) : configKey ? (
                    <PermissionAccessBoundary configKey={configKey} />
                  ) : null}
                </SettingsHeaderShell>
              )}
            </SettingsHeaderProvider>
          )}
        </Suspense>
      </div>
      <ChipConfirmModal
        open={pendingLeave !== null}
        onOpenChange={(open) => !open && cancelLeave()}
        srTitle='Unsaved changes'
        title='Unsaved changes'
        text='You have unsaved changes. Are you sure you want to discard them?'
        dismissLabel='Keep editing'
        confirm={{ label: 'Discard changes', onClick: confirmLeave }}
      />
    </div>
  )
}
