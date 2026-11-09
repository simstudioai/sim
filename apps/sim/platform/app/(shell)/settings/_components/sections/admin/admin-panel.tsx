'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import { Switch } from '@sim/emcn/switch'
import { useRouter } from 'next/navigation'
import { SectionStack } from '@/platform/app/(shell)/_components/settings-parts/settings-parts'
import { AdminDirectory } from '@/platform/app/(shell)/settings/_components/sections/admin/admin-directory'
import type {
  AdminExample,
  AdminPreferences,
} from '@/platform/app/(shell)/settings/_components/sections/admin/model'
import {
  type ImportInputs,
  WorkflowImport,
} from '@/platform/app/(shell)/settings/_components/sections/admin/workflow-import'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import { useSettingsFixtureDraft } from '@/platform/lib/data/settings-providers'

const ENVIRONMENTS = [
  { value: 'default', label: 'Default' },
  { value: 'dev', label: 'Dev' },
  { value: 'staging', label: 'Staging' },
  { value: 'prod', label: 'Prod' },
] as const

interface AdminPanelProps {
  preferences: AdminPreferences | null
  example: AdminExample | null
  benchmarkAvailable: boolean
  benchmarkHref?: string
  manageHref: string
}

export function AdminPanel({
  preferences,
  example,
  benchmarkAvailable,
  benchmarkHref,
  manageHref,
}: AdminPanelProps) {
  const router = useRouter()
  const { data: draft, update } = useSettingsFixtureDraft('admin', example)
  function setDraft(value: AdminExample) {
    update(() => value)
  }
  const [viewingAs, setViewingAs] = useState<string>()
  const [inputs, setInputs] = useState<ImportInputs>({ workflow: '', target: '' })
  const guard = useSettingsUnsavedGuard({
    isDirty: Boolean(inputs.workflow.trim() || inputs.target.trim()),
    onDiscard: () => setInputs({ workflow: '', target: '' }),
  })
  const settings = draft ?? preferences

  if (viewingAs) {
    return (
      <InlineNotice
        title='Impersonation preview'
        message={`Viewing as ${viewingAs}.`}
        action={
          <Button size='compact' onClick={() => setViewingAs(undefined)}>
            End impersonation
          </Button>
        }
      />
    )
  }

  return (
    <SectionStack>
      <SettingsSection title='Administration'>
        {settings ? (
          <>
            <SettingsRow label='Super admin mode'>
              {draft ? (
                <Switch
                  label='Super admin mode'
                  checked={settings.superUserModeEnabled}
                  onCheckedChange={(superUserModeEnabled) =>
                    setDraft({ ...draft, superUserModeEnabled })
                  }
                />
              ) : (
                <Button size='compact' render={<a href={manageHref}>Manage admin settings</a>}>
                  {settings.superUserModeEnabled ? 'Manage · On' : 'Manage · Off'}
                </Button>
              )}
            </SettingsRow>
            {settings.superUserModeEnabled && benchmarkAvailable && (
              <SettingsRow
                label='Benchmarks'
                description={
                  benchmarkHref ? undefined : 'The benchmark console opens in the main Sim app.'
                }
              >
                <Button
                  size='compact'
                  disabled={!benchmarkHref}
                  render={benchmarkHref ? <a href={benchmarkHref}>Open benchmarks</a> : undefined}
                >
                  Open benchmarks
                </Button>
              </SettingsRow>
            )}
            {settings.superUserModeEnabled && (
              <SettingsRow
                label='Mothership environment'
                description='Default uses the configured Sim agent URL.'
              >
                {draft ? (
                  <ChoiceMenu
                    label='Mothership environment'
                    value={settings.mothershipEnvironment}
                    options={ENVIRONMENTS}
                    onValueChange={(mothershipEnvironment) =>
                      setDraft({ ...draft, mothershipEnvironment })
                    }
                  />
                ) : (
                  <Button
                    size='compact'
                    render={<a href={manageHref}>Manage admin settings</a>}
                  >{`Change · ${ENVIRONMENTS.find((item) => item.value === settings.mothershipEnvironment)?.label ?? settings.mothershipEnvironment}`}</Button>
                )}
              </SettingsRow>
            )}
          </>
        ) : (
          <FailureNotice
            message='Could not load admin settings.'
            onRetry={() => router.refresh()}
          />
        )}
      </SettingsSection>
      <WorkflowImport
        example={draft}
        onEdit={setDraft}
        manageHref={manageHref}
        inputs={inputs}
        onChange={setInputs}
      />
      <AdminDirectory
        example={draft}
        onEdit={setDraft}
        manageHref={manageHref}
        onImpersonate={(user) =>
          guard.guardBack(() => {
            if (!draft) return
            setDraft({
              ...draft,
              recent: [user.id, ...draft.recent.filter((id) => id !== user.id)].slice(0, 5),
            })
            setViewingAs(user.email)
          })
        }
      />
    </SectionStack>
  )
}
