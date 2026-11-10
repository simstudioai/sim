'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { Switch } from '@sim/emcn/switch'
import Link from 'next/link'
import { SectionStack } from '@/app/(product)/_components/settings-parts/settings-parts'
import { AdminDirectory } from '@/app/(product)/o/[organizationId]/settings/_components/sections/admin/admin-directory'
import { WorkflowImport } from '@/app/(product)/o/[organizationId]/settings/_components/sections/admin/workflow-import'
import type { AdminConsole, ImportInputs } from '@/platform/lib/data/admin-model'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'

const ENVIRONMENTS = [
  { value: 'default', label: 'Default' },
  { value: 'dev', label: 'Dev' },
  { value: 'staging', label: 'Staging' },
  { value: 'prod', label: 'Prod' },
] as const

const BENCHMARK_HREF = '/benchmark'

export function AdminPanel({ console: admin }: { console: AdminConsole }) {
  const { settings, importer, directory } = admin
  const [inputs, setInputs] = useState<ImportInputs>({ workflow: '', target: '' })
  const guard = useSettingsUnsavedGuard({
    isDirty: Boolean(inputs.workflow.trim() || inputs.target.trim()),
    navigationBlocked: importer.pending || directory.impersonating,
    onDiscard: () => setInputs({ workflow: '', target: '' }),
  })

  return (
    <SectionStack>
      <SettingsSection title='Administration'>
        {settings === null ? (
          <FailureNotice message='Could not load admin settings.' onRetry={admin.retrySettings} />
        ) : (
          settings && (
            <>
              <SettingsRow label='Super admin mode'>
                <Switch
                  label='Super admin mode'
                  checked={settings.superUserModeEnabled}
                  disabled={admin.savingSetting}
                  onCheckedChange={admin.setSuperUserMode}
                />
              </SettingsRow>
              {settings.superUserModeEnabled && admin.benchmarkAvailable && (
                <SettingsRow label='Benchmarks'>
                  <Button
                    size='compact'
                    render={<Link href={BENCHMARK_HREF}>Open benchmarks</Link>}
                  >
                    Open benchmarks
                  </Button>
                </SettingsRow>
              )}
              {settings.superUserModeEnabled && (
                <SettingsRow label='Mothership environment'>
                  <ChoiceMenu
                    label='Mothership environment'
                    value={settings.mothershipEnvironment}
                    options={ENVIRONMENTS}
                    disabled={admin.savingSetting}
                    onValueChange={(value) => {
                      const choice = ENVIRONMENTS.find((item) => item.value === value)
                      if (choice) admin.setMothershipEnvironment(choice.value)
                    }}
                  />
                </SettingsRow>
              )}
            </>
          )
        )}
      </SettingsSection>
      <WorkflowImport
        importer={importer}
        inputs={inputs}
        onChange={(next) => {
          setInputs(next)
          importer.reset()
        }}
        onImported={() => setInputs({ workflow: '', target: '' })}
      />
      <AdminDirectory
        directory={directory}
        onImpersonate={(user) => guard.guardBack(() => directory.impersonate(user))}
      />
    </SectionStack>
  )
}
