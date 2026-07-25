'use client'

import { useState } from 'react'
import { ChipInput, ChipSelect, toast } from '@sim/emcn'
import { ArrowLeft, Database } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { CreateDataDrainBody } from '@/lib/api/contracts/data-drains'
import type { CADENCE_TYPES, SOURCE_TYPES } from '@/lib/data-drains/types'
import { DESTINATION_TYPES } from '@/lib/data-drains/types'
import { ResourceTile } from '@/app/workspace/[workspaceId]/components'
import {
  CredentialDetailHeading,
  UnsavedChangesModal,
} from '@/app/workspace/[workspaceId]/components/credential-detail'
import type { SettingsAction } from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useSettingsUnsavedGuard } from '@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard'
import { SettingRow } from '@/ee/components/setting-row'
import { DESTINATION_FORM_REGISTRY } from '@/ee/data-drains/destinations/registry'
import { useCreateDataDrain } from '@/ee/data-drains/hooks/data-drains'
import {
  CADENCE_OPTIONS,
  DESTINATION_LABELS,
  DESTINATION_OPTIONS,
  SOURCE_OPTIONS,
} from '@/ee/data-drains/labels'

const logger = createLogger('DataDrainCreate')

interface DataDrainCreateProps {
  organizationId: string
  onBack: () => void
  /** Lands the caller on the drain it just created, matching the skills create flow. */
  onCreated: (drainId: string) => void
}

/**
 * Full-page data drain creation rendered as a settings detail sub-view: a back
 * chip, a Create action, and the common fields plus the selected destination's
 * own fields from {@link DESTINATION_FORM_REGISTRY}.
 */
export function DataDrainCreate({ organizationId, onBack, onCreated }: DataDrainCreateProps) {
  const createDrain = useCreateDataDrain()

  const [name, setName] = useState('')
  const [source, setSource] = useState<(typeof SOURCE_TYPES)[number]>('workflow_logs')
  const [cadence, setCadence] = useState<(typeof CADENCE_TYPES)[number]>('daily')
  const [destinationType, setDestinationType] = useState<(typeof DESTINATION_TYPES)[number]>(
    DESTINATION_TYPES[0]
  )
  const [destState, setDestState] = useState<unknown>(
    () => DESTINATION_FORM_REGISTRY[DESTINATION_TYPES[0]].initialState
  )

  const spec = DESTINATION_FORM_REGISTRY[destinationType]
  const canSubmit = name.trim().length > 0 && spec.isComplete(destState)

  const submitError = createDrain.error ? toError(createDrain.error).message : null
  const isDirty =
    name.trim().length > 0 ||
    JSON.stringify(destState) !== JSON.stringify(spec.initialState) ||
    source !== 'workflow_logs' ||
    cadence !== 'daily' ||
    destinationType !== DESTINATION_TYPES[0]

  const guard = useSettingsUnsavedGuard({ isDirty })

  const handleDestinationChange = (next: (typeof DESTINATION_TYPES)[number]) => {
    setDestinationType(next)
    setDestState(DESTINATION_FORM_REGISTRY[next].initialState)
  }

  const handleSubmit = async () => {
    if (!canSubmit || createDrain.isPending) return
    const body = {
      name: name.trim(),
      source,
      scheduleCadence: cadence,
      ...spec.toDestinationBranch(destState),
    } as CreateDataDrainBody
    try {
      const drain = await createDrain.mutateAsync({ organizationId, body })
      toast.success('Drain created')
      onCreated(drain.id)
    } catch (error) {
      const message = toError(error).message
      toast.error("Couldn't create drain", { description: message })
      logger.error('Failed to create data drain', { error: message })
    }
  }

  const actions: SettingsAction[] = [
    {
      text: createDrain.isPending ? 'Creating...' : 'Create',
      variant: 'primary',
      onSelect: handleSubmit,
      disabled: !canSubmit || createDrain.isPending,
      tooltip: canSubmit ? undefined : 'Name the drain and complete its destination',
    },
  ]

  return (
    <>
      <SettingsPanel
        back={{ text: 'Data drains', icon: ArrowLeft, onSelect: () => guard.guardBack(onBack) }}
        title='New drain'
        actions={actions}
      >
        <div className='flex flex-col gap-7'>
          <CredentialDetailHeading
            leading={<ResourceTile icon={Database} />}
            title='New drain'
            subtitle='Export logs, chats, and runs to your own storage or observability stack on a schedule.'
          />

          <SettingsSection label='Drain'>
            <div className='flex flex-col gap-4'>
              <SettingRow label='Name' htmlFor='data-drain-name'>
                <ChipInput
                  id='data-drain-name'
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder='Workflow logs export'
                />
              </SettingRow>
              <SettingRow label='Source'>
                <ChipSelect
                  aria-label='Source'
                  value={source}
                  onChange={(v) => setSource(v as (typeof SOURCE_TYPES)[number])}
                  options={SOURCE_OPTIONS}
                  align='start'
                />
              </SettingRow>
              <SettingRow label='Cadence'>
                <ChipSelect
                  aria-label='Cadence'
                  value={cadence}
                  onChange={(v) => setCadence(v as (typeof CADENCE_TYPES)[number])}
                  options={CADENCE_OPTIONS}
                  align='start'
                />
              </SettingRow>
            </div>
          </SettingsSection>

          <SettingsSection label='Destination'>
            <div className='flex flex-col gap-4'>
              <SettingRow label='Type'>
                <ChipSelect
                  aria-label='Destination type'
                  value={destinationType}
                  onChange={(v) => handleDestinationChange(v as (typeof DESTINATION_TYPES)[number])}
                  options={DESTINATION_OPTIONS}
                  displayLabel={DESTINATION_LABELS[destinationType]}
                  align='start'
                />
              </SettingRow>
              <spec.FormFields state={destState} setState={setDestState} />
              {submitError && (
                <p role='alert' className='text-[var(--text-error)] text-caption'>
                  {submitError}
                </p>
              )}
            </div>
          </SettingsSection>
        </div>
      </SettingsPanel>

      <UnsavedChangesModal
        open={guard.showUnsavedModal}
        onOpenChange={guard.setShowUnsavedModal}
        onDiscard={guard.confirmDiscard}
      />
    </>
  )
}
