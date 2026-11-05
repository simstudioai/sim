'use client'

import { useState } from 'react'
import { toError } from '@sim/utils/errors'
import {
  ActionRow,
  DetailHeader,
  FieldStack,
  FormFieldset,
  Muted,
  QueryErrorState,
  SectionStack,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { useUnsavedGuard } from '@/platform/app/(shell)/settings/_components/section-parts/use-unsaved-guard'
import {
  Button,
  Checkbox,
  SecretField,
  SelectField,
  TextAreaField,
  TextField,
} from '@/platform/design-system/components'
import { SettingsSection } from '@/platform/design-system/components/settings-section/settings-section'
import {
  CADENCE_OPTIONS,
  type CADENCE_TYPES,
  type CreateDataDrainBody,
  DESTINATION_OPTIONS,
  DESTINATION_SPECS,
  DESTINATION_TYPES,
  type DestinationField,
  type DestinationState,
  SOURCE_OPTIONS,
  type SOURCE_TYPES,
  useCreateDataDrain,
} from '@/platform/lib/data/data-drains'
import { toast } from '@/platform/lib/data/toast'

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
  const createDrain = useCreateDataDrain()
  const [name, setName] = useState('')
  const [source, setSource] = useState<(typeof SOURCE_TYPES)[number]>('workflow_logs')
  const [cadence, setCadence] = useState<(typeof CADENCE_TYPES)[number]>('daily')
  const [destinationType, setDestinationType] = useState<(typeof DESTINATION_TYPES)[number]>(
    DESTINATION_TYPES[0]
  )
  const [destState, setDestState] = useState<DestinationState>(
    () => DESTINATION_SPECS[DESTINATION_TYPES[0]].initialState
  )
  const spec = DESTINATION_SPECS[destinationType]
  const canSubmit = name.trim().length > 0 && spec.isComplete(destState)
  const isDirty =
    name.trim().length > 0 ||
    JSON.stringify(destState) !== JSON.stringify(spec.initialState) ||
    source !== 'workflow_logs' ||
    cadence !== 'daily' ||
    destinationType !== DESTINATION_TYPES[0]
  const guard = useUnsavedGuard({
    isDirty,
    navigationBlocked: createDrain.isPending,
    onDiscard: () => {
      setName('')
      setSource('workflow_logs')
      setCadence('daily')
      setDestinationType(DESTINATION_TYPES[0])
      setDestState(DESTINATION_SPECS[DESTINATION_TYPES[0]].initialState)
    },
  })

  async function submit() {
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
      toast.error("Couldn't create drain", { description: toError(error).message })
    }
  }

  return (
    <SectionStack>
      <DetailHeader
        backLabel='Data drains'
        onBack={() => guard.guardBack(onBack)}
        title='New drain'
        description='Export logs, chats, and runs to your own storage or observability stack on a schedule.'
      />
      <FormFieldset disabled={createDrain.isPending}>
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
                if (createDrain.isPending) return
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
                  if (!createDrain.isPending) setDestState(next)
                }}
              />
            ))}
            {createDrain.error && <QueryErrorState message={toError(createDrain.error).message} />}
          </FieldStack>
        </SettingsSection>
        <ActionRow>
          <Button
            variant='primary'
            disabled={!canSubmit || createDrain.isPending}
            onClick={() => void submit()}
          >
            {createDrain.isPending ? 'Creating…' : 'Create'}
          </Button>
          {!canSubmit && <Muted>Name the drain and complete its destination</Muted>}
        </ActionRow>
      </FormFieldset>
      {guard.dialog}
    </SectionStack>
  )
}
