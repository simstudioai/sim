'use client'

import { useState } from 'react'
import { toError } from '@sim/utils/errors'
import type { CreateDataDrainBody } from '@/lib/api/contracts/data-drains'
import { type CADENCE_TYPES, DESTINATION_TYPES, type SOURCE_TYPES } from '@/lib/data-drains/types'
import {
  DESTINATION_SPECS,
  type DestinationField,
  type DestinationState,
} from '@/ee/data-drains/destinations/specs'
import { CADENCE_OPTIONS, DESTINATION_OPTIONS, SOURCE_OPTIONS } from '@/ee/data-drains/labels'
import { useSettingsUnsavedGuard } from '@/hooks/use-settings-unsaved-guard'
import {
  Button,
  Checkbox,
  InlineNotice,
  SecretField,
  SelectField,
  TextAreaField,
  TextField,
} from '@/platform/design-system/components'
import { SettingsSection } from '@/platform/design-system/components/settings-section/settings-section'
import {
  ActionRow,
  DetailHeader,
  FieldStack,
  FormFieldset,
  Muted,
  SectionStack,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import { useDrainCreate } from '@/platform/embedded/lib/data/drains'

const DEFAULT_SOURCE = 'workflow_logs' satisfies (typeof SOURCE_TYPES)[number]
const DEFAULT_CADENCE = 'daily' satisfies (typeof CADENCE_TYPES)[number]
const DEFAULT_DESTINATION = DESTINATION_TYPES[0]

interface DestinationInputProps {
  field: DestinationField<DestinationState>
  state: DestinationState
  onChange: (state: DestinationState) => void
}

/** Credentials are write-only: nothing returns them, so a drain's secrets are never shown again. */
function DestinationInput({ field, state, onChange }: DestinationInputProps) {
  if (field.kind === 'note') return <Muted>{field.text}</Muted>
  const set = (value: string | boolean) => onChange({ ...state, [field.key]: value })
  switch (field.kind) {
    case 'select':
      return (
        <SelectField
          label={field.label}
          options={field.options}
          value={String(state[field.key])}
          onValueChange={set}
        />
      )
    case 'switch':
      return (
        <Checkbox label={field.label} checked={Boolean(state[field.key])} onCheckedChange={set} />
      )
    case 'secret':
      return (
        <SecretField
          label={field.label}
          placeholder={field.placeholder}
          autoComplete='new-password'
          value={String(state[field.key])}
          onChange={set}
        />
      )
    case 'text':
      return (
        <TextField
          label={field.label}
          placeholder={field.placeholder}
          autoComplete='off'
          value={String(state[field.key])}
          onChange={set}
        />
      )
    default:
      return (
        <TextAreaField
          label={field.label}
          placeholder={field.placeholder}
          value={String(state[field.key])}
          onChange={set}
        />
      )
  }
}

interface DrainCreateProps {
  organizationId: string
  onBack: () => void
  onCreated: (drainId: string) => void
}

export function DrainCreate({ organizationId, onBack, onCreated }: DrainCreateProps) {
  const createDrain = useDrainCreate(organizationId, onCreated)
  const [name, setName] = useState('')
  const [source, setSource] = useState<(typeof SOURCE_TYPES)[number]>(DEFAULT_SOURCE)
  const [cadence, setCadence] = useState<(typeof CADENCE_TYPES)[number]>(DEFAULT_CADENCE)
  const [destinationType, setDestinationType] =
    useState<(typeof DESTINATION_TYPES)[number]>(DEFAULT_DESTINATION)
  const [destState, setDestState] = useState<DestinationState>(
    () => DESTINATION_SPECS[DEFAULT_DESTINATION].initialState
  )
  const spec = DESTINATION_SPECS[destinationType]
  const canSubmit = name.trim().length > 0 && spec.isComplete(destState)
  const isDirty =
    name.trim().length > 0 ||
    JSON.stringify(destState) !== JSON.stringify(spec.initialState) ||
    source !== DEFAULT_SOURCE ||
    cadence !== DEFAULT_CADENCE ||
    destinationType !== DEFAULT_DESTINATION
  const guard = useSettingsUnsavedGuard({
    isDirty,
    navigationBlocked: createDrain.pending,
    onDiscard: () => {
      setName('')
      setSource(DEFAULT_SOURCE)
      setCadence(DEFAULT_CADENCE)
      setDestinationType(DEFAULT_DESTINATION)
      setDestState(DESTINATION_SPECS[DEFAULT_DESTINATION].initialState)
    },
  })

  async function submit() {
    if (!canSubmit || createDrain.pending) return
    const body = {
      name: name.trim(),
      source,
      scheduleCadence: cadence,
      ...spec.toDestinationBranch(destState),
    } as CreateDataDrainBody
    await createDrain.create(body)
  }

  return (
    <SectionStack>
      <DetailHeader
        backLabel='Data drains'
        onBack={() => guard.guardBack(onBack)}
        title='New drain'
        description='Export logs, chats, and runs to your own storage or observability stack on a schedule.'
      />
      <FormFieldset disabled={createDrain.pending}>
        <SettingsSection title='Drain'>
          <FieldStack>
            <TextField
              label='Name'
              placeholder='Workflow logs export'
              value={name}
              onChange={setName}
            />
            <SelectField
              label='Source'
              options={SOURCE_OPTIONS}
              value={source}
              onValueChange={(value) => setSource(value as typeof source)}
            />
            <SelectField
              label='Cadence'
              options={CADENCE_OPTIONS}
              value={cadence}
              onValueChange={(value) => setCadence(value as typeof cadence)}
            />
          </FieldStack>
        </SettingsSection>
        <SettingsSection title='Destination'>
          <FieldStack>
            <SelectField
              label='Destination type'
              options={DESTINATION_OPTIONS}
              value={destinationType}
              onValueChange={(value) => {
                if (createDrain.pending) return
                const next = value as typeof destinationType
                setDestinationType(next)
                setDestState(DESTINATION_SPECS[next].initialState)
              }}
            />
            {spec.fields.map((field) => (
              <DestinationInput
                key={field.kind === 'note' ? field.text : field.key}
                field={field}
                state={destState}
                onChange={(next) => {
                  if (!createDrain.pending) setDestState(next)
                }}
              />
            ))}
            {createDrain.error && (
              <InlineNotice intent='danger' message={toError(createDrain.error).message} />
            )}
          </FieldStack>
        </SettingsSection>
        <ActionRow>
          <Button
            variant='primary'
            disabled={!canSubmit || createDrain.pending}
            onClick={() => void submit()}
          >
            {createDrain.pending ? 'Creating…' : 'Create'}
          </Button>
          {!canSubmit && <Muted>Name the drain and complete its destination</Muted>}
        </ActionRow>
      </FormFieldset>
    </SectionStack>
  )
}
