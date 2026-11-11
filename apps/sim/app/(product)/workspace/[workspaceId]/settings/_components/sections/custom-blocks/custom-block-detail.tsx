'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { TextAreaField, TextField } from '@sim/emcn/field'
import { FileField } from '@sim/emcn/field/file-field'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { InlineNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { compareStrings } from '@sim/utils/string'
import { toast } from '@/lib/toast/sink'
import { SettingsSaveBar } from '@/app/(product)/_components/settings-parts/save-bar'
import {
  ActionRow,
  DetailHeader,
  FieldStack,
  FormFieldset,
  Muted,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SwitchRow } from '@/app/(product)/_components/settings-parts/switch-row'
import { BlockInputs } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/custom-blocks/block-inputs'
import { BlockOutputs } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/custom-blocks/block-outputs'
import { BlockSource } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/custom-blocks/block-source'
import {
  type CustomBlock,
  type CustomBlockInput,
  type CustomBlockInputPlaceholder,
  type CustomBlockOutput,
  extractInputFieldsFromBlocks,
  isReservedOutputName,
  useCustomBlockUsageCounts,
  useDeleteCustomBlock,
  useProfilePictureUpload,
  usePublishCustomBlock,
  useUpdateCustomBlock,
  useWorkspacesQuery,
} from '@/platform/lib/data/custom-blocks'
import { requestSettingsLeave, useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import {
  flattenWorkflowOutputs,
  useDeployedWorkflowState,
  useWorkflows,
} from '@/platform/lib/data/workflows/records'
import { plural } from '@/platform/shared/plural'

const OUTPUT_SEP = '::'
const ICON_ACCEPT = 'image/png,image/jpeg,image/jpg,image/svg+xml,image/webp'

const encodeOutput = (blockId: string, path: string) => `${blockId}${OUTPUT_SEP}${path}`
const decodeOutput = (value: string) => {
  const i = value.indexOf(OUTPUT_SEP)
  return i === -1
    ? { blockId: '', path: value }
    : { blockId: value.slice(0, i), path: value.slice(i + OUTPUT_SEP.length) }
}

/** A unique, friendly output name from a dot-path, avoiding collisions and reserved names. */
function deriveOutputName(path: string, taken: Set<string>): string {
  const base = (path.split('.').pop() || path).replace(/[^a-zA-Z0-9_]/g, '_')
  let name = base
  let n = 2
  while (taken.has(name) || isReservedOutputName(name)) name = `${base}_${n++}`
  taken.add(name)
  return name
}

interface CustomBlockFormValues {
  name: string
  description: string
  inputs: CustomBlockInput[]
  outputs: CustomBlockOutput[]
  traceChildRuns: boolean
  iconUrl: string | null
}

interface CustomBlockDraft {
  baseline: CustomBlockFormValues
  values: CustomBlockFormValues
}

/** Seeds the editable inputs from a block's live-derived input fields. */
function toCustomBlockInputs(fields: CustomBlock['inputFields'] | undefined): CustomBlockInput[] {
  return (fields ?? []).map((f) => ({
    id: f.id ?? f.name,
    name: f.name,
    type: f.type,
    placeholder: f.placeholder,
    description: f.description,
    required: f.required,
  }))
}

function normalizeInputOverrides(
  items: readonly CustomBlockInput[]
): CustomBlockInputPlaceholder[] {
  return items
    .filter((input) => input.placeholder?.trim() || input.required)
    .map((input) => ({
      id: input.id,
      ...(input.placeholder?.trim() ? { placeholder: input.placeholder.trim() } : {}),
      ...(input.required ? { required: true } : {}),
    }))
    .sort((left, right) => compareStrings(left.id, right.id))
}

function sameOutputs(left: readonly CustomBlockOutput[], right: readonly CustomBlockOutput[]) {
  return (
    left.length === right.length &&
    left.every(
      (output, index) =>
        output.blockId === right[index].blockId &&
        output.path === right[index].path &&
        output.name.trim() === right[index].name.trim()
    )
  )
}

function sameInputOverrides(
  left: readonly CustomBlockInputPlaceholder[],
  right: readonly CustomBlockInputPlaceholder[]
) {
  return (
    left.length === right.length &&
    left.every(
      (input, index) =>
        input.id === right[index].id &&
        input.placeholder === right[index].placeholder &&
        input.required === right[index].required
    )
  )
}

/** Whether two forms would save the same block: names trimmed, inputs reduced to their overrides. */
function sameFormValues(left: CustomBlockFormValues, right: CustomBlockFormValues) {
  return (
    left.name.trim() === right.name.trim() &&
    left.description.trim() === right.description.trim() &&
    left.iconUrl === right.iconUrl &&
    left.traceChildRuns === right.traceChildRuns &&
    sameOutputs(left.outputs, right.outputs) &&
    sameInputOverrides(normalizeInputOverrides(left.inputs), normalizeInputOverrides(right.inputs))
  )
}

interface CustomBlockDetailProps {
  /** The block being edited, or `null` to publish a new one. */
  existing: CustomBlock | null
  workspaceId: string
  onBack: () => void
}

/**
 * Publishes a deployed workflow as an organization-wide block, or edits one. Only an administrator
 * of the block's source workspace may change it, as its routes enforce; others read it.
 */
export function CustomBlockDetail({ existing, workspaceId, onBack }: CustomBlockDetailProps) {
  const isCreate = existing === null

  const publish = usePublishCustomBlock()
  const update = useUpdateCustomBlock()
  const remove = useDeleteCustomBlock()

  const { data: workspaces = [] } = useWorkspacesQuery()
  const canManageBlock =
    isCreate || workspaces.some((w) => w.id === existing?.workspaceId && w.permissions === 'admin')
  // Blocks are organization-scoped and the list shows only this organization's, so the source must
  // be a workspace in this organization the viewer administers, as the publish route requires.
  const currentOrgId = workspaces.find((w) => w.id === workspaceId)?.organizationId ?? null
  const orgWorkspaces = currentOrgId
    ? workspaces.filter((w) => w.organizationId === currentOrgId && w.permissions === 'admin')
    : []
  const eligibleDefaultWorkspaceId = orgWorkspaces.some((w) => w.id === workspaceId)
    ? workspaceId
    : (orgWorkspaces[0]?.id ?? workspaceId)
  /** The picked source workspace, which falls back to the default while it is not an eligible one. */
  const [pickedWorkspaceId, setPickedWorkspaceId] = useState<string | null>(null)
  const selectedWorkspaceId =
    pickedWorkspaceId && orgWorkspaces.some((w) => w.id === pickedWorkspaceId)
      ? pickedWorkspaceId
      : eligibleDefaultWorkspaceId
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('')
  const { data: workflows = [] } = useWorkflows(isCreate ? selectedWorkspaceId : undefined)

  const workflowId = existing ? existing.workflowId : selectedWorkflowId

  const savedValues: CustomBlockFormValues = {
    name: existing?.name ?? '',
    description: existing?.description ?? '',
    inputs: toCustomBlockInputs(existing?.inputFields),
    outputs: existing?.exposedOutputs ?? [],
    traceChildRuns: existing?.traceChildRuns ?? false,
    iconUrl: existing?.iconUrl ?? null,
  }
  const [draft, setDraft] = useState<CustomBlockDraft | null>(null)
  const values = draft?.values ?? savedValues
  const { name, description, inputs, outputs, traceChildRuns } = values
  const [error, setError] = useState<string | null>(null)
  const [showDelete, setShowDelete] = useState(false)
  const [confirmationText, setConfirmationText] = useState('')

  // Fetched with the view so the count is warm before the delete dialog opens.
  const usageCountsQuery = useCustomBlockUsageCounts(existing?.id, { enabled: canManageBlock })
  const usageCount = usageCountsQuery.data?.usageCount ?? 0

  const iconUpload = useProfilePictureUpload({
    currentImage: values.iconUrl,
    onUpload: (iconUrl) => updateForm((current) => ({ ...current, iconUrl })),
    onError: (message) => setError(message),
    context: 'workspace-logos',
    workspaceId,
  })
  const iconUrl = iconUpload.previewUrl

  // The block always runs the source's latest deployment, so curate against the deployed state.
  const deployed = useDeployedWorkflowState(workflowId || null)
  const deployedState = deployed.data
  const deployedLoaded = Boolean(deployedState) && !deployed.isLoading
  const notDeployed = Boolean(workflowId) && !deployed.isLoading && deployedState === null

  const availableFields = deployedState?.blocks
    ? extractInputFieldsFromBlocks(deployedState.blocks)
    : []
  const fieldById = new Map(availableFields.map((f) => [f.id ?? f.name, f]))
  const overrideById = new Map(inputs.map((i) => [i.id, i]))

  // Every deployed Start input is exposed. Name, type and description come from the field itself;
  // only the placeholder and the required flag are authored here.
  const visibleInputs: CustomBlockInput[] = deployedLoaded
    ? availableFields.map((f) => {
        const id = f.id ?? f.name
        return {
          id,
          name: f.name,
          type: f.type,
          description: f.description,
          placeholder: overrideById.get(id)?.placeholder,
          required: overrideById.get(id)?.required,
        }
      })
    : inputs

  const labelByKey = new Map<string, string>()
  const outputOptions = deployedState?.blocks
    ? flattenWorkflowOutputs(Object.values(deployedState.blocks), deployedState.edges ?? []).map(
        (f) => {
          const key = encodeOutput(f.blockId, f.path)
          const label = `${f.blockName} › ${f.path}`
          labelByKey.set(key, label)
          return { value: key, label }
        }
      )
    : []

  const visibleOutputs = deployedLoaded
    ? outputs.filter((o) => labelByKey.has(encodeOutput(o.blockId, o.path)))
    : outputs
  const outputFields = visibleOutputs.map((o) => {
    const key = encodeOutput(o.blockId, o.path)
    return { key, label: labelByKey.get(key) ?? o.path, name: o.name }
  })

  const formChanged = Boolean(
    draft && (!sameFormValues(draft.values, draft.baseline) || iconUrl !== draft.baseline.iconUrl)
  )
  const dirty =
    formChanged ||
    (isCreate && Boolean(selectedWorkflowId || selectedWorkspaceId !== eligibleDefaultWorkspaceId))

  const mutating = publish.isPending || update.isPending || remove.isPending
  const saving = mutating || iconUpload.isUploading
  /**
   * The save bar registers an edit's draft; the publish flow, which submits through Create block
   * instead, registers its own here, and a delete holds navigation either way.
   */
  useSettingsUnsavedGuard({
    isDirty: isCreate && dirty,
    navigationBlocked: remove.isPending || (isCreate && saving),
    onDiscard: isCreate ? handleDiscard : undefined,
  })
  // Outputs are required: there is no "expose the whole result" option.
  const saveDisabled =
    !name.trim() ||
    !workflowId ||
    notDeployed ||
    iconUpload.isUploading ||
    deployed.isLoading ||
    (deployedLoaded && visibleOutputs.length === 0)
  const fieldsDisabled = saving || !canManageBlock

  function updateForm(change: (current: CustomBlockFormValues) => CustomBlockFormValues) {
    if (mutating) return
    setDraft((current) => {
      const baseline = current?.baseline ?? savedValues
      const values = change(current?.values ?? savedValues)
      // An edit back to the saved block drops the draft, so the view follows the saved block again.
      return sameFormValues(values, baseline) && !iconUpload.isUploading
        ? null
        : { baseline, values }
    })
  }

  function setInputOverride(
    id: string,
    patch: Partial<Pick<CustomBlockInput, 'placeholder' | 'required'>>
  ) {
    updateForm((current) => {
      const prev = current.inputs
      if (prev.some((i) => i.id === id)) {
        return { ...current, inputs: prev.map((i) => (i.id === id ? { ...i, ...patch } : i)) }
      }
      const f = fieldById.get(id)
      return {
        ...current,
        inputs: [...prev, { id, name: f?.name ?? id, type: f?.type ?? 'string', ...patch }],
      }
    })
  }

  function handleOutputsChange(nextKeys: string[]) {
    const byKey = new Map(outputs.map((o) => [encodeOutput(o.blockId, o.path), o]))
    const taken = new Set(outputs.map((o) => o.name))
    updateForm((current) => ({
      ...current,
      outputs: nextKeys.map((key) => {
        const ex = byKey.get(key)
        if (ex) return ex
        const { blockId, path } = decodeOutput(key)
        return { blockId, path, name: deriveOutputName(path, taken) }
      }),
    }))
  }

  function setOutputName(key: string, value: string) {
    updateForm((current) => ({
      ...current,
      outputs: current.outputs.map((o) =>
        encodeOutput(o.blockId, o.path) === key ? { ...o, name: value } : o
      ),
    }))
  }

  function handleDiscard() {
    if (isCreate) {
      setPickedWorkspaceId(null)
      setSelectedWorkflowId('')
    }
    setDraft(null)
    iconUpload.reset()
    setError(null)
  }

  async function handleSave() {
    setError(null)
    const exposedOutputs = visibleOutputs.map((o) => ({ ...o, name: o.name.trim() }))
    if (exposedOutputs.length === 0) {
      setError('Pick at least one output to expose')
      return
    }
    if (exposedOutputs.some((o) => !o.name)) {
      setError('Every exposed output needs a name')
      return
    }
    if (new Set(exposedOutputs.map((o) => o.name)).size !== exposedOutputs.length) {
      setError('Output names must be unique')
      return
    }
    const reserved = exposedOutputs.find((o) => isReservedOutputName(o.name))
    if (reserved) {
      setError(`"${reserved.name}" is a reserved output name (success, error, cost)`)
      return
    }
    const inputPlaceholders = normalizeInputOverrides(visibleInputs)

    try {
      if (existing) {
        const iconChanged =
          (iconUrl || null) !== (draft ? draft.baseline.iconUrl : existing.iconUrl)
        await update.mutateAsync({
          id: existing.id,
          name: name.trim(),
          description: description.trim(),
          inputs: inputPlaceholders,
          exposedOutputs,
          traceChildRuns,
          ...(iconChanged ? { iconUrl: iconUrl || null } : {}),
        })
        toast.success('Block updated')
      } else {
        await publish.mutateAsync({
          workspaceId: selectedWorkspaceId,
          workflowId,
          name: name.trim(),
          description: description.trim(),
          inputs: inputPlaceholders,
          exposedOutputs,
          traceChildRuns,
          ...(iconUrl ? { iconUrl } : {}),
        })
        toast.success('Block created')
      }
      onBack()
    } catch (caught) {
      setError(getErrorMessage(caught, 'Failed to save block'))
    }
  }

  return (
    <SectionStack>
      <DetailHeader
        backLabel='Custom blocks'
        onBack={() => requestSettingsLeave(onBack)}
        title={existing?.name || 'New block'}
        description='Publish a deployed workflow as a reusable, organization-wide block'
      />
      {error && <InlineNotice intent='danger' message={error} />}
      <FormFieldset disabled={fieldsDisabled}>
        <BlockSource
          existing={existing}
          notDeployed={notDeployed}
          workspaces={orgWorkspaces}
          workspaceId={selectedWorkspaceId}
          onWorkspaceChange={(next) => {
            setPickedWorkspaceId(next)
            setSelectedWorkflowId('')
          }}
          workflows={workflows}
          workflowId={selectedWorkflowId}
          onWorkflowChange={setSelectedWorkflowId}
        />
        <SettingsSection title='Details'>
          <FieldStack>
            <FileField
              kind='image'
              label='Icon (square)'
              accept={ICON_ACCEPT}
              optional
              disabled={fieldsDisabled}
              onFileChange={(file) => {
                if (fieldsDisabled) return
                setDraft((current) => current ?? { baseline: savedValues, values: savedValues })
                void iconUpload.handleFile(file)
              }}
              onClear={iconUpload.handleRemove}
              selection={
                iconUrl
                  ? { name: iconUpload.isUploading ? 'Uploading…' : 'Icon', previewSrc: iconUrl }
                  : undefined
              }
            />
            <TextField
              label='Name'
              value={name}
              onChange={(next) => updateForm((current) => ({ ...current, name: next }))}
              placeholder='Invoice Parser'
              maxLength={60}
              disabled={fieldsDisabled}
            />
            <TextAreaField
              label='Description'
              value={description}
              onChange={(next) => updateForm((current) => ({ ...current, description: next }))}
              placeholder='What this block does'
              maxLength={280}
              disabled={fieldsDisabled}
            />
          </FieldStack>
        </SettingsSection>
        <BlockInputs
          loading={deployed.isLoading}
          inputs={visibleInputs}
          disabled={fieldsDisabled}
          onChange={setInputOverride}
        />
        <BlockOutputs
          options={outputOptions}
          outputs={outputFields}
          pickerDisabled={
            saving || deployed.isLoading || outputOptions.length === 0 || !canManageBlock
          }
          disabled={fieldsDisabled}
          onOutputsChange={handleOutputsChange}
          onNameChange={setOutputName}
        />
        <SettingsSection title='Tracing'>
          <SwitchRow
            label='Trace runs in consumer logs'
            description='Show this block’s steps, inputs and prompts in the logs of every workflow that runs it, including to people outside this workspace'
            checked={traceChildRuns}
            disabled={fieldsDisabled}
            onCheckedChange={(checked) =>
              updateForm((current) => ({ ...current, traceChildRuns: checked }))
            }
          />
        </SettingsSection>
      </FormFieldset>
      {isCreate ? (
        <ActionRow>
          <Button
            variant='primary'
            disabled={saveDisabled || saving}
            onClick={() => void handleSave()}
          >
            {saving ? 'Creating…' : 'Create block'}
          </Button>
        </ActionRow>
      ) : (
        canManageBlock && (
          <SettingsSaveBar
            dirty={dirty}
            saving={saving}
            blocked={saveDisabled}
            onSave={() => void handleSave()}
            onDiscard={handleDiscard}
          />
        )
      )}
      {existing && canManageBlock && (
        <SettingsSection title='Manage block'>
          <SettingsRow
            label='Delete block'
            description='Remove this block for everyone who uses it'
          >
            <Button
              variant='quiet'
              destructive
              disabled={remove.isPending}
              onClick={() => {
                setConfirmationText('')
                setShowDelete(true)
                // The warning must reflect the organization's current usage, not a cached count.
                void usageCountsQuery.refetch()
              }}
            >
              Delete
            </Button>
          </SettingsRow>
        </SettingsSection>
      )}
      {existing && (
        <ConfirmDialog
          target={showDelete}
          onClose={() => setShowDelete(false)}
          title='Delete custom block'
          description={`${existing.name} is removed for everyone who uses it. This action cannot be undone.`}
          confirmLabel='Delete'
          pendingLabel='Deleting…'
          confirmDisabled={confirmationText !== existing.name}
          onConfirm={async () => {
            await remove.mutateAsync(existing.id)
            toast.success('Block deleted')
            onBack()
          }}
        >
          {usageCountsQuery.data &&
            (usageCount > 0 ? (
              <InlineNotice
                intent='danger'
                message={`${plural(usageCount, 'workflow')} still ${usageCount === 1 ? 'uses' : 'use'} this block and will fail at run time`}
              />
            ) : (
              <Muted>No workflows use it</Muted>
            ))}
          <TextField
            label={`Type ${existing.name} to confirm`}
            value={confirmationText}
            onChange={setConfirmationText}
            placeholder={existing.name}
            autoComplete='off'
          />
        </ConfirmDialog>
      )}
    </SectionStack>
  )
}
