'use client'

import { useEffect, useMemo, useState } from 'react'
import { Chip, toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { isEqual } from 'es-toolkit'
import { useParams } from 'next/navigation'
import { CodexConfigEditor } from '@/components/codex/codex-config-editor'
import { type CodexConfigPatch, resolveCodexConfig } from '@/lib/codex/config'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  useUpdateWorkspaceCodexConfig,
  useWorkspaceCodexConfig,
} from '@/hooks/queries/codex-config'

/** Workspace-wide base overlay inherited by every Codex workflow and Agent. */
export function CodexSettings() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params.workspaceId
  const permissions = useUserPermissionsContext()
  const canEdit = permissions.canEdit
  const query = useWorkspaceCodexConfig(workspaceId)
  const update = useUpdateWorkspaceCodexConfig()
  const [draft, setDraft] = useState<CodexConfigPatch | null>(null)

  useEffect(() => {
    if (query.data && draft === null) setDraft(query.data.config)
  }, [draft, query.data])

  const systemDefaults = useMemo(() => resolveCodexConfig({}), [])
  const saved = query.data?.config ?? {}
  const dirty = draft !== null && !isEqual(draft, saved)

  const handleSave = async () => {
    if (!draft) return
    try {
      await update.mutateAsync({ workspaceId, config: draft })
      toast.success('Workspace Codex defaults saved')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to save Codex defaults'))
    }
  }

  if (query.isLoading || (draft === null && !query.error)) {
    return (
      <SettingsPanel>
        <div className='py-10 text-center text-[var(--text-muted)] text-sm'>
          Loading Codex defaults…
        </div>
      </SettingsPanel>
    )
  }

  if (query.error || draft === null) {
    return (
      <SettingsPanel>
        <div className='rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-[var(--text-error)] text-sm'>
          {getErrorMessage(query.error, 'Failed to load Codex defaults')}
        </div>
      </SettingsPanel>
    )
  }

  return (
    <SettingsPanel>
      <div className='flex flex-col gap-7'>
        <SettingsSection
          label='Workspace profile'
          action={
            <Chip
              variant='primary'
              onClick={() => void handleSave()}
              disabled={!canEdit || !dirty || update.isPending}
            >
              {update.isPending ? 'Saving…' : 'Save'}
            </Chip>
          }
        >
          <div className='flex flex-col gap-4'>
            <p className='max-w-2xl text-[var(--text-muted)] text-sm'>
              This is the shared base layer for every workflow in the workspace. Each workflow,
              Agent, and step stores only its own overrides, so changing a value here updates all
              descendants that still inherit it.
            </p>
            <CodexConfigEditor
              value={draft}
              inherited={systemDefaults}
              onChange={setDraft}
              disabled={!canEdit || update.isPending}
            />
          </div>
        </SettingsSection>

        <SettingsSection label='Overlay order'>
          <div className='grid max-w-2xl grid-cols-4 gap-2 text-center text-xs'>
            {['Workspace', 'Workflow', 'Agent', 'Step'].map((layer, index) => (
              <div
                key={layer}
                className='relative rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-2.5'
              >
                <span className='text-[var(--text-secondary)]'>{layer}</span>
                {index < 3 && (
                  <span className='-right-2.5 -translate-y-1/2 absolute top-1/2 z-10 text-[var(--text-muted)]'>
                    →
                  </span>
                )}
              </div>
            ))}
          </div>
          <p className='mt-2 text-[var(--text-muted)] text-xs'>
            Later layers win per field. Reasoning effort is step-overridable; stable repository and
            runtime settings normally stop at the Agent layer.
          </p>
        </SettingsSection>

        <SettingsSection label='Credentials'>
          <p className='max-w-2xl text-[var(--text-muted)] text-sm'>
            API keys are intentionally outside these overlays. Configure the OpenAI key under BYOK
            and keep GitHub tokens in Secrets so configuration inheritance never copies secret
            values into workflow metadata.
          </p>
        </SettingsSection>
      </div>
    </SettingsPanel>
  )
}
