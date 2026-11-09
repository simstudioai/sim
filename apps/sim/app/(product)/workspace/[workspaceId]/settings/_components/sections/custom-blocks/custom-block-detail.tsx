'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { SwitchField, TextAreaField, TextField } from '@sim/emcn/field'
import { FileField } from '@sim/emcn/field/file-field'
import { Modal } from '@sim/emcn/modal'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { SaveActions } from '@sim/emcn/settings-section/save-actions'
import { InlineNotice } from '@sim/emcn/status'
import { Switch } from '@sim/emcn/switch'
import { getErrorMessage } from '@sim/utils/errors'
import { compareStrings } from '@sim/utils/string'
import { toast } from '@/lib/toast/sink'
import {
  DetailHeader,
  FieldStack,
  FormFieldset,
  Muted,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { MetadataFields } from '@/app/(product)/_components/workspace/metadata-fields/metadata-fields'
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
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import {
  flattenWorkflowOutputs,
  useDeployedWorkflowState,
  useWorkflows,
} from '@/platform/lib/data/workflows/records'

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

function sameFormValues(left: CustomBlockFormValues, right: CustomBlockFormValues) {
  return (
    left.name.trim() === right.name.trim() &&
    left.description.trim() === right.description.trim() &&
    left.iconUrl === right.iconUrl &&
    left.traceChildRuns === right.traceChildRuns &&
    JSON.stringify(left.outputs.map((output) => ({ ...output, name: output.name.trim() }))) ===
      JSON.stringify(right.outputs.map((output) => ({ ...output, name: output.name.trim() }))) &&
    JSON.stringify(normalizeInputOverrides(left.inputs)) ===
      JSON.stringify(normalizeInputOverrides(right.inputs))
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
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(workspaceId)
  if (
    isCreate &&
    orgWorkspaces.length > 0 &&
    !orgWorkspaces.some((w) => w.id === selectedWorkspaceId)
  ) {
    setSelectedWorkspaceId(eligibleDefaultWorkspaceId)
  }
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
  const selectedOutputKeys = visibleOutputs.map((o) => encodeOutput(o.blockId, o.path))

  const formChanged = Boolean(
    draft && (!sameFormValues(draft.values, draft.baseline) || iconUrl !== draft.baseline.iconUrl)
  )
  const dirty =
    formChanged ||
    (isCreate && Boolean(selectedWorkflowId || selectedWorkspaceId !== eligibleDefaultWorkspaceId))

  if (
    draft &&
    !formChanged &&
    !iconUpload.isUploading &&
    JSON.stringify(draft.values) === JSON.stringify(draft.baseline)
  )
    setDraft(null)

  const mutating = publish.isPending || update.isPending || remove.isPending
  const saving = mutating || iconUpload.isUploading
  const guard = useSettingsUnsavedGuard({
    isDirty: dirty,
    navigationBlocked: saving,
    onDiscard: handleDiscard,
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
    setDraft((current) => ({
      baseline: current?.baseline ?? savedValues,
      values: change(current?.values ?? savedValues),
    }))
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
      setSelectedWorkspaceId(eligibleDefaultWorkspaceId)
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
        onBack={() => guard.guardBack(onBack)}
        title={existing?.name || 'New block'}
        description='Publish a deployed workflow as a reusable, org-wide block.'
      />
      {error && <InlineNotice intent='danger' message={error} />}
      <FormFieldset disabled={fieldsDisabled}>
        <SettingsSection title='Source'>
          <FieldStack>
            {existing ? (
              <>
                <MetadataFields
                  label='Source workflow'
                  fields={[
                    { id: 'workspace', label: 'Workspace', value: existing.workspaceName ?? '—' },
                    { id: 'workflow', label: 'Workflow', value: existing.workflowName },
                  ]}
                />
                <Muted>
                  {notDeployed
                    ? 'This workflow isn’t deployed. Redeploy it so the block can run.'
                    : 'The source workflow can’t be changed.'}
                </Muted>
              </>
            ) : (
              <>
                <SearchableSelect
                  label='Workspace'
                  options={orgWorkspaces.map((w) => ({ value: w.id, label: w.name }))}
                  value={selectedWorkspaceId}
                  onValueChange={(next) => {
                    if (!next) return
                    setSelectedWorkspaceId(next)
                    setSelectedWorkflowId('')
                  }}
                  placeholder='Select a workspace'
                  searchLabel='Search workspaces'
                />
                <SearchableSelect
                  label='Workflow'
                  options={workflows.map((w) => ({ value: w.id, label: w.name }))}
                  value={selectedWorkflowId || null}
                  onValueChange={(next) => setSelectedWorkflowId(next ?? '')}
                  placeholder='Select a workflow'
                  searchLabel='Search workflows'
                  hint='Only deployed workflows can be published.'
                  error={
                    notDeployed
                      ? 'This workflow isn’t deployed. Deploy it first, then publish it as a block.'
                      : undefined
                  }
                  disabled={workflows.length === 0}
                  disabledReason={
                    workflows.length === 0 ? 'No workflows in this workspace.' : undefined
                  }
                />
              </>
            )}
          </FieldStack>
        </SettingsSection>
        <SettingsSection title='Details'>
          <FieldStack>
            <FileField
              kind='image'
              label='Icon'
              hint='Square image (PNG, JPEG, or SVG).'
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
        <SettingsSection title='Inputs'>
          <FieldStack>
            <Muted>
              Every Start input is exposed. Add a placeholder for each; its own description carries
              over.
            </Muted>
            {!deployed.isLoading && visibleInputs.length === 0 && (
              <Muted>This workflow’s Start block has no inputs.</Muted>
            )}
            {!deployed.isLoading &&
              visibleInputs.map((input) => (
                <InputOverride
                  key={input.id}
                  input={input}
                  disabled={fieldsDisabled}
                  onChange={(patch) => setInputOverride(input.id, patch)}
                />
              ))}
          </FieldStack>
        </SettingsSection>
        <SettingsSection title='Outputs'>
          <FieldStack>
            <MultiSelect
              label='Outputs'
              hint='Pick which workflow outputs consumers see and name each one. At least one is required.'
              options={outputOptions}
              value={selectedOutputKeys}
              onValueChange={handleOutputsChange}
              placeholder='Select outputs'
              searchLabel='Search outputs'
              disabled={
                saving || deployed.isLoading || outputOptions.length === 0 || !canManageBlock
              }
            />
            {visibleOutputs.map((o) => {
              const key = encodeOutput(o.blockId, o.path)
              return (
                <TextField
                  key={key}
                  label={labelByKey.get(key) ?? o.path}
                  value={o.name}
                  onChange={(next) => setOutputName(key, next)}
                  placeholder='name'
                  maxLength={60}
                  disabled={fieldsDisabled}
                />
              )
            })}
          </FieldStack>
        </SettingsSection>
        <SettingsSection title='Tracing'>
          <SettingsRow
            label='Trace runs in consumer logs'
            description='Shows this block’s steps inside the trace of every workflow that runs it, org-wide. Anyone who can read those logs sees the source workflow’s block names, inputs, outputs, and prompts — including people with no access to this workspace.'
          >
            <Switch
              label='Trace runs in consumer logs'
              checked={traceChildRuns}
              onCheckedChange={(checked) =>
                updateForm((current) => ({ ...current, traceChildRuns: checked }))
              }
              disabled={fieldsDisabled}
            />
          </SettingsRow>
        </SettingsSection>
      </FormFieldset>
      {canManageBlock && (
        <SaveActions
          dirty={dirty}
          saving={saving}
          blocked={saveDisabled}
          onSave={() => void handleSave()}
          onDiscard={handleDiscard}
        />
      )}
      {existing && canManageBlock && (
        <SettingsSection title='Manage block'>
          <SettingsRow label='Delete block'>
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
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </SettingsRow>
        </SettingsSection>
      )}
      {existing && (
        <Modal
          variant='confirm'
          destructive
          open={showDelete}
          onOpenChange={setShowDelete}
          title='Delete custom block'
          description={`Delete ${existing.name}? This cannot be undone.`}
          confirmLabel='Delete'
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
                message={`${usageCount} ${usageCount === 1 ? 'workflow is' : 'workflows are'} still using this block and will fail at run time.`}
              />
            ) : (
              <Muted>No workflows are currently using it.</Muted>
            ))}
          <TextField
            label={`Type ${existing.name} to confirm`}
            value={confirmationText}
            onChange={setConfirmationText}
            placeholder={existing.name}
            autoComplete='off'
          />
        </Modal>
      )}
    </SectionStack>
  )
}

interface InputOverrideProps {
  input: CustomBlockInput
  disabled: boolean
  onChange: (patch: Partial<Pick<CustomBlockInput, 'placeholder' | 'required'>>) => void
}

/** One exposed Start input: whether consumers must fill it, and the hint its empty field shows. */
function InputOverride({ input, disabled, onChange }: InputOverrideProps) {
  return (
    <>
      <TextField
        label={input.name}
        hint={input.description ? `${input.type} · ${input.description}` : input.type}
        value={input.placeholder ?? ''}
        onChange={(placeholder) => onChange({ placeholder })}
        placeholder='Shown in the empty field'
        maxLength={200}
        disabled={disabled}
      />
      <SwitchField
        label={`${input.name} required`}
        checked={input.required ?? false}
        onCheckedChange={(required) => onChange({ required })}
        disabled={disabled}
      />
    </>
  )
}
