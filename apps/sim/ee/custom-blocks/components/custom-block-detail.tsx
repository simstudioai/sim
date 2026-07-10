'use client'

import { useMemo, useState } from 'react'
import {
  Badge,
  Button,
  ChipCombobox,
  ChipConfirmModal,
  ChipInput,
  ChipModalField,
  ChipTextarea,
  type ComboboxOptionGroup,
  cn,
  Expandable,
  ExpandableContent,
  Label,
  Loader,
  Switch,
  toast,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { ArrowLeft, ChevronDown, Image as ImageIcon, X } from 'lucide-react'
import {
  type FlattenOutputsBlockInput,
  type FlattenOutputsEdgeInput,
  flattenWorkflowOutputs,
} from '@/lib/workflows/blocks/flatten-outputs'
import { extractInputFieldsFromBlocks } from '@/lib/workflows/input-format'
import { UnsavedChangesModal } from '@/app/workspace/[workspaceId]/components/credential-detail'
import { DropZone } from '@/app/workspace/[workspaceId]/components/drop-zone'
import { saveDiscardActions } from '@/app/workspace/[workspaceId]/settings/components/save-discard-actions/save-discard-actions'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { useProfilePictureUpload } from '@/app/workspace/[workspaceId]/settings/hooks/use-profile-picture-upload'
import { useSettingsUnsavedGuard } from '@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard'
import type { CustomBlockInput, CustomBlockOutput } from '@/blocks/custom/build-config'
import { SettingRow } from '@/ee/components/setting-row'
import {
  useCustomBlocks,
  useCustomBlockUsageCounts,
  useDeleteCustomBlock,
  usePublishCustomBlock,
  useUpdateCustomBlock,
} from '@/hooks/queries/custom-blocks'
import { useDeployedWorkflowState } from '@/hooks/queries/deployments'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

const OUTPUT_SEP = '::'
const ICON_ACCEPT = 'image/png,image/jpeg,image/jpg,image/svg+xml,image/webp'

const encodeOutput = (blockId: string, path: string) => `${blockId}${OUTPUT_SEP}${path}`
const decodeOutput = (value: string) => {
  const i = value.indexOf(OUTPUT_SEP)
  return i === -1
    ? { blockId: '', path: value }
    : { blockId: value.slice(0, i), path: value.slice(i + OUTPUT_SEP.length) }
}

/** Derive a unique, friendly output name from a dot-path, avoiding collisions. */
function deriveOutputName(path: string, taken: Set<string>): string {
  const base = (path.split('.').pop() || path).replace(/[^a-zA-Z0-9_]/g, '_')
  let name = base
  let n = 2
  while (taken.has(name)) name = `${base}_${n++}`
  taken.add(name)
  return name
}

interface CustomBlockDetailProps {
  blockId: string | null
  workspaceId: string
  onBack: () => void
}

export function CustomBlockDetail({ blockId, workspaceId, onBack }: CustomBlockDetailProps) {
  const isCreate = blockId === null

  const { data: blocks = [] } = useCustomBlocks(workspaceId)
  const existing = useMemo(
    () => (blockId ? (blocks.find((b) => b.id === blockId) ?? null) : null),
    [blocks, blockId]
  )

  const publish = usePublishCustomBlock(workspaceId)
  const update = useUpdateCustomBlock(workspaceId)
  const remove = useDeleteCustomBlock(workspaceId)

  // Needed in both modes: the source picker (create) and the manage gate (edit).
  const { data: workspaces = [] } = useWorkspacesQuery()

  // A block is manageable only by an admin of its SOURCE workspace — the same authz
  // the publish/update/delete routes enforce. Everyone else gets a read-only view
  // (no Save/Discard, no Delete, disabled fields). Create is always manageable: the
  // list gates the entry on workspace-admin and the picker only offers admin workspaces.
  const canManageBlock =
    isCreate || workspaces.some((w) => w.id === existing?.workspaceId && w.permissions === 'admin')
  // Custom blocks are org-scoped and the settings list only shows the current org's
  // blocks, so a block published to another org's workspace would silently never
  // appear here. Restrict the picker to workspaces in the current workspace's org.
  const currentOrgId = useMemo(
    () => workspaces.find((w) => w.id === workspaceId)?.organizationId ?? null,
    [workspaces, workspaceId]
  )
  // Only workspaces the user can publish from (admin) — the publish route requires
  // admin on the source workspace, so a member/read workspace can never be a source.
  const orgWorkspaces = useMemo(
    () =>
      currentOrgId
        ? workspaces.filter((w) => w.organizationId === currentOrgId && w.permissions === 'admin')
        : [],
    [workspaces, currentOrgId]
  )
  const eligibleDefaultWorkspaceId = useMemo(
    () =>
      orgWorkspaces.some((w) => w.id === workspaceId)
        ? workspaceId
        : (orgWorkspaces[0]?.id ?? workspaceId),
    [orgWorkspaces, workspaceId]
  )
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(workspaceId)
  // Once the eligible list loads, snap an ineligible selection (e.g. the current
  // workspace when the user isn't its admin) to the first workspace they can publish from.
  if (
    isCreate &&
    orgWorkspaces.length > 0 &&
    !orgWorkspaces.some((w) => w.id === selectedWorkspaceId)
  ) {
    setSelectedWorkspaceId(eligibleDefaultWorkspaceId)
  }
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('')
  const { data: workflows = [] } = useWorkflows(isCreate ? selectedWorkspaceId : undefined)

  const workflowId = isCreate ? selectedWorkflowId : (existing?.workflowId ?? '')

  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [inputs, setInputs] = useState<CustomBlockInput[]>(() =>
    toCustomBlockInputs(existing?.inputFields)
  )
  const [outputs, setOutputs] = useState<CustomBlockOutput[]>(() => existing?.exposedOutputs ?? [])
  const [error, setError] = useState<string | null>(null)
  const [showDelete, setShowDelete] = useState(false)

  // Type-to-confirm buffer for the delete modal — reset whenever the modal opens.
  const [confirmationText, setConfirmationText] = useState('')
  const [prevShowDelete, setPrevShowDelete] = useState(false)
  if (showDelete !== prevShowDelete) {
    setPrevShowDelete(showDelete)
    if (showDelete) setConfirmationText('')
  }

  // Fetched with the view so the count is warm before the delete modal opens.
  // Server-gated on the same manage authz as delete.
  const usageCountsQuery = useCustomBlockUsageCounts(existing?.id, { enabled: canManageBlock })
  const usageCount = usageCountsQuery.data?.usageCount ?? 0

  // Edit mode may mount before `useCustomBlocks` has resolved this row, leaving the
  // buffers empty. Reseed them the first time the block's identity loads (or when it
  // changes) — keyed on `existing.id` so a later refetch of the SAME block doesn't
  // clobber in-progress edits. (The icon reseeds itself via `currentImage`.)
  const [seededId, setSeededId] = useState(existing?.id ?? null)
  if (existing && existing.id !== seededId) {
    setSeededId(existing.id)
    setName(existing.name)
    setDescription(existing.description ?? '')
    setInputs(toCustomBlockInputs(existing.inputFields))
    setOutputs(existing.exposedOutputs ?? [])
  }

  const iconUpload = useProfilePictureUpload({
    currentImage: existing?.iconUrl ?? null,
    onError: (e) => setError(e),
    context: 'workspace-logos',
    workspaceId,
  })
  const iconUrl = iconUpload.previewUrl

  // The block always runs the source's LATEST DEPLOYMENT, so curate against the
  // deployed state (draft-only blocks/inputs would resolve to nothing at runtime).
  const deployed = useDeployedWorkflowState(workflowId || null)
  const deployedLoaded = Boolean(deployed.data) && !deployed.isLoading
  const notDeployed = Boolean(workflowId) && !deployed.isLoading && deployed.data === null

  const availableFields = useMemo(() => {
    const state = deployed.data as { blocks?: Record<string, unknown> } | null | undefined
    if (!state?.blocks) return []
    return extractInputFieldsFromBlocks(state.blocks)
  }, [deployed.data])

  const fieldById = useMemo(() => {
    const m = new Map<string, (typeof availableFields)[number]>()
    for (const f of availableFields) m.set(f.id ?? f.name, f)
    return m
  }, [availableFields])

  const overrideById = useMemo(() => {
    const m = new Map<string, CustomBlockInput>()
    for (const i of inputs) m.set(i.id, i)
    return m
  }, [inputs])

  // Every deployed Start input is exposed (no selection). Name/type/description are
  // inherited from the field itself (the Start block already defines them); only
  // the placeholder and required flag are authored here.
  const visibleInputs = useMemo<CustomBlockInput[]>(
    () =>
      deployedLoaded
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
        : inputs,
    [deployedLoaded, availableFields, overrideById, inputs]
  )

  const [expandedInputs, setExpandedInputs] = useState<ReadonlySet<string>>(new Set())
  const toggleInput = (id: string) =>
    setExpandedInputs((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const { outputGroups, labelByKey } = useMemo(() => {
    const state = deployed.data as
      | { blocks?: Record<string, FlattenOutputsBlockInput>; edges?: FlattenOutputsEdgeInput[] }
      | null
      | undefined
    const labels = new Map<string, string>()
    if (!state?.blocks) return { outputGroups: [] as ComboboxOptionGroup[], labelByKey: labels }
    const flat = flattenWorkflowOutputs(Object.values(state.blocks), state.edges ?? [])
    const byBlock = new Map<
      string,
      { blockName: string; items: { label: string; value: string }[] }
    >()
    for (const f of flat) {
      const key = encodeOutput(f.blockId, f.path)
      labels.set(key, `${f.blockName} › ${f.path}`)
      const group = byBlock.get(f.blockId) ?? { blockName: f.blockName, items: [] }
      group.items.push({ label: f.path, value: key })
      byBlock.set(f.blockId, group)
    }
    return {
      outputGroups: Array.from(byBlock.values()).map((g) => ({
        section: g.blockName,
        items: g.items,
      })),
      labelByKey: labels,
    }
  }, [deployed.data])

  const visibleOutputs = useMemo(
    () =>
      deployedLoaded
        ? outputs.filter((o) => labelByKey.has(encodeOutput(o.blockId, o.path)))
        : outputs,
    [outputs, deployedLoaded, labelByKey]
  )
  const selectedOutputKeys = useMemo(
    () => visibleOutputs.map((o) => encodeOutput(o.blockId, o.path)),
    [visibleOutputs]
  )

  const dirty = existing
    ? name.trim() !== existing.name ||
      description.trim() !== (existing.description ?? '') ||
      (iconUrl || null) !== (existing.iconUrl ?? null) ||
      JSON.stringify(visibleOutputs) !== JSON.stringify(existing.exposedOutputs) ||
      JSON.stringify(normalizeInputsForCompare(visibleInputs)) !==
        JSON.stringify(normalizeInputsForCompare(existing.inputFields))
    : Boolean(
        name.trim() ||
          description.trim() ||
          selectedWorkflowId ||
          selectedWorkspaceId !== eligibleDefaultWorkspaceId ||
          iconUrl ||
          visibleOutputs.length > 0 ||
          visibleInputs.some((i) => i.placeholder?.trim())
      )

  const guard = useSettingsUnsavedGuard({ isDirty: dirty })

  const saving = publish.isPending || update.isPending || remove.isPending
  // Outputs are required — there is no "expose the whole result" option.
  const saveDisabled =
    !name.trim() ||
    !workflowId ||
    notDeployed ||
    iconUpload.isUploading ||
    deployed.isLoading ||
    (deployedLoaded && visibleOutputs.length === 0)

  // Upsert an authored per-input override (placeholder/required). `visibleInputs`
  // shows every deployed field; the first edit of a field adds its override row.
  function setInputOverride(
    id: string,
    patch: Partial<Pick<CustomBlockInput, 'placeholder' | 'required'>>
  ) {
    setInputs((prev) => {
      if (prev.some((i) => i.id === id)) {
        return prev.map((i) => (i.id === id ? { ...i, ...patch } : i))
      }
      const f = fieldById.get(id)
      return [...prev, { id, name: f?.name ?? id, type: f?.type ?? 'string', ...patch }]
    })
  }

  function handleOutputsChange(nextKeys: string[]) {
    const byKey = new Map(outputs.map((o) => [encodeOutput(o.blockId, o.path), o]))
    const taken = new Set(outputs.map((o) => o.name))
    setOutputs(
      nextKeys.map((key) => {
        const ex = byKey.get(key)
        if (ex) return ex
        const { blockId, path } = decodeOutput(key)
        return { blockId, path, name: deriveOutputName(path, taken) }
      })
    )
  }

  function setOutputName(key: string, value: string) {
    setOutputs((prev) =>
      prev.map((o) => (encodeOutput(o.blockId, o.path) === key ? { ...o, name: value } : o))
    )
  }

  function handleDiscard() {
    if (isCreate) {
      setSelectedWorkspaceId(eligibleDefaultWorkspaceId)
      setSelectedWorkflowId('')
    }
    setName(existing?.name ?? '')
    setDescription(existing?.description ?? '')
    setInputs(toCustomBlockInputs(existing?.inputFields))
    setOutputs(existing?.exposedOutputs ?? [])
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
    // Only the placeholder and required flag are authored; the field set/name/type
    // are always derived from the deployed Start. Persist only non-empty overrides.
    const inputPlaceholders = visibleInputs
      .filter((i) => i.placeholder?.trim() || i.required)
      .map((i) => ({
        id: i.id,
        ...(i.placeholder?.trim() ? { placeholder: i.placeholder.trim() } : {}),
        ...(i.required ? { required: true } : {}),
      }))

    try {
      if (existing) {
        const iconChanged = (iconUrl || null) !== (existing.iconUrl ?? null)
        await update.mutateAsync({
          id: existing.id,
          name: name.trim(),
          description: description.trim(),
          inputs: inputPlaceholders,
          exposedOutputs,
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
          ...(iconUrl ? { iconUrl } : {}),
        })
        toast.success('Block created')
      }
      onBack()
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to save block'))
    }
  }

  async function handleDelete() {
    if (!existing) return
    try {
      await remove.mutateAsync(existing.id)
      toast.success('Block deleted')
      onBack()
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to delete block'))
    }
  }

  return (
    <>
      <SettingsPanel
        back={{ text: 'Custom blocks', icon: ArrowLeft, onSelect: () => guard.guardBack(onBack) }}
        title={existing?.name || 'New block'}
        description='Publish a deployed workflow as a reusable, org-wide block.'
        actions={[
          ...(canManageBlock
            ? saveDiscardActions({
                dirty,
                saving,
                onSave: handleSave,
                onDiscard: handleDiscard,
                saveDisabled,
              })
            : []),
          ...(existing && canManageBlock
            ? [
                {
                  text: remove.isPending ? 'Deleting...' : 'Delete',
                  variant: 'destructive' as const,
                  onSelect: () => setShowDelete(true),
                  disabled: remove.isPending,
                },
              ]
            : []),
        ]}
      >
        <div className='flex flex-col gap-5 py-1'>
          {error && (
            <div className='rounded-md border border-[color-mix(in_srgb,var(--text-error)_20%,transparent)] bg-[color-mix(in_srgb,var(--text-error)_10%,transparent)] px-3 py-2 text-[var(--text-error)] text-small'>
              {error}
            </div>
          )}

          {isCreate && (
            <>
              <SettingRow label='Workspace'>
                <ChipCombobox
                  className='w-full'
                  dropdownWidth='trigger'
                  searchable
                  placeholder='Select a workspace'
                  options={orgWorkspaces.map((w) => ({ value: w.id, label: w.name }))}
                  value={selectedWorkspaceId}
                  onChange={(v: string) => {
                    setSelectedWorkspaceId(v)
                    setSelectedWorkflowId('')
                  }}
                />
              </SettingRow>
              <SettingRow label='Workflow' description='Only deployed workflows can be published.'>
                <ChipCombobox
                  className='w-full'
                  dropdownWidth='trigger'
                  searchable
                  placeholder='Select a workflow'
                  emptyMessage='No workflows in this workspace.'
                  options={workflows.map((w) => ({ value: w.id, label: w.name }))}
                  value={selectedWorkflowId}
                  onChange={(v: string) => setSelectedWorkflowId(v)}
                />
                {notDeployed && (
                  <p className='mt-1.5 text-[var(--text-error)] text-caption'>
                    This workflow isn’t deployed. Deploy it first, then publish it as a block.
                  </p>
                )}
              </SettingRow>
            </>
          )}

          {!isCreate && existing && (
            <>
              <SettingRow label='Workspace'>
                <ChipInput value={existing.workspaceName ?? '—'} onChange={() => {}} disabled />
              </SettingRow>
              <SettingRow label='Workflow' description='The source workflow can’t be changed.'>
                <ChipInput value={existing.workflowName} onChange={() => {}} disabled />
                {notDeployed && (
                  <p className='mt-1.5 text-[var(--text-error)] text-caption'>
                    This workflow isn’t deployed. Redeploy it so the block can run.
                  </p>
                )}
              </SettingRow>
            </>
          )}

          <SettingRow label='Icon' labelTooltip='Square image (PNG, JPEG, or SVG). Optional.'>
            <div className='flex items-center gap-4'>
              <DropZone onDrop={canManageBlock ? iconUpload.handleFileDrop : () => {}}>
                <button
                  type='button'
                  onClick={iconUpload.handleThumbnailClick}
                  disabled={iconUpload.isUploading || !canManageBlock}
                  className='group relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] transition-colors hover:bg-[var(--surface-3)] disabled:opacity-50'
                >
                  {iconUpload.isUploading ? (
                    <Loader className='size-5 text-[var(--text-muted)]' animate />
                  ) : iconUrl ? (
                    <img src={iconUrl} alt='' className='size-full object-contain p-1.5' />
                  ) : (
                    <ImageIcon className='size-5 text-[var(--text-muted)]' />
                  )}
                </button>
              </DropZone>
              <div className='flex gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={iconUpload.handleThumbnailClick}
                  disabled={iconUpload.isUploading || !canManageBlock}
                  className='text-[13px]'
                >
                  {iconUrl ? 'Change' : 'Upload'}
                </Button>
                {iconUrl && (
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    onClick={iconUpload.handleRemove}
                    disabled={iconUpload.isUploading || !canManageBlock}
                    className='text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  >
                    <X className='size-[14px]' />
                  </Button>
                )}
              </div>
              <input
                ref={iconUpload.fileInputRef}
                type='file'
                accept={ICON_ACCEPT}
                className='hidden'
                onChange={iconUpload.handleFileChange}
              />
            </div>
          </SettingRow>

          <SettingRow label='Name'>
            <ChipInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='Invoice Parser'
              maxLength={60}
              disabled={!canManageBlock}
            />
          </SettingRow>

          <SettingRow label='Description'>
            <ChipTextarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder='What this block does'
              rows={2}
              maxLength={280}
              disabled={!canManageBlock}
            />
          </SettingRow>

          <SettingRow
            label='Inputs'
            description='Every Start input is exposed. Add a placeholder for each; its own description carries over.'
          >
            {deployed.isLoading ? (
              <p className='text-[var(--text-muted)] text-small'>Loading workflow…</p>
            ) : visibleInputs.length === 0 ? (
              <p className='text-[var(--text-muted)] text-small'>
                This workflow’s Start block has no inputs.
              </p>
            ) : (
              <div className='flex flex-col gap-2'>
                {visibleInputs.map((i) => {
                  const expanded = expandedInputs.has(i.id)
                  return (
                    <div
                      key={i.id}
                      className='overflow-hidden rounded-sm border border-[var(--border-1)]'
                    >
                      <div
                        role='button'
                        tabIndex={0}
                        className='flex cursor-pointer items-center justify-between bg-[var(--surface-4)] px-2.5 py-[5px]'
                        onClick={() => toggleInput(i.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            toggleInput(i.id)
                          }
                        }}
                      >
                        <div className='flex min-w-0 flex-1 items-center gap-2'>
                          <span className='block truncate font-medium text-[var(--text-tertiary)] text-sm'>
                            {i.name}
                          </span>
                          <Badge variant='type' size='sm'>
                            {i.type}
                          </Badge>
                        </div>
                        <ChevronDown
                          className={cn(
                            'size-[14px] shrink-0 text-[var(--text-muted)] transition-transform',
                            expanded && 'rotate-180'
                          )}
                        />
                      </div>
                      <Expandable expanded={expanded}>
                        <ExpandableContent>
                          <div className='flex flex-col gap-2 border-[var(--border-1)] border-t bg-[var(--surface-2)] px-2.5 pt-1.5 pb-2.5'>
                            {i.description && (
                              <div className='flex flex-col gap-1.5'>
                                <Label>Description</Label>
                                <p className='text-[var(--text-muted)] text-caption'>
                                  {i.description}
                                </p>
                              </div>
                            )}
                            <div className='flex items-center justify-between'>
                              <Label htmlFor={`input-required-${i.id}`}>Required</Label>
                              <Switch
                                id={`input-required-${i.id}`}
                                checked={i.required ?? false}
                                onCheckedChange={(checked) =>
                                  setInputOverride(i.id, { required: checked })
                                }
                                disabled={!canManageBlock}
                              />
                            </div>
                            <div className='flex flex-col gap-1.5'>
                              <Label>Placeholder</Label>
                              <ChipInput
                                value={i.placeholder ?? ''}
                                onChange={(e) =>
                                  setInputOverride(i.id, { placeholder: e.target.value })
                                }
                                placeholder='Shown in the empty field'
                                maxLength={200}
                                disabled={!canManageBlock}
                              />
                            </div>
                          </div>
                        </ExpandableContent>
                      </Expandable>
                    </div>
                  )
                })}
              </div>
            )}
          </SettingRow>

          <SettingRow
            label='Outputs'
            description='Pick which workflow outputs consumers see and name each one. At least one is required.'
          >
            <ChipCombobox
              multiSelect
              searchable
              searchPlaceholder='Search outputs…'
              className='w-full'
              dropdownWidth='trigger'
              maxHeight={280}
              disabled={deployed.isLoading || outputGroups.length === 0 || !canManageBlock}
              emptyMessage={deployed.isLoading ? 'Loading workflow…' : 'No outputs found.'}
              options={[]}
              groups={outputGroups}
              multiSelectValues={selectedOutputKeys}
              onMultiSelectChange={handleOutputsChange}
              overlayContent={
                <span className='truncate text-[var(--text-primary)]'>
                  {visibleOutputs.length === 0
                    ? 'Select outputs'
                    : `${visibleOutputs.length} selected`}
                </span>
              }
            />
            {visibleOutputs.length > 0 && (
              <div className='mt-2 flex flex-col gap-2'>
                {visibleOutputs.map((o) => {
                  const key = encodeOutput(o.blockId, o.path)
                  return (
                    <div key={key} className='flex items-center gap-2'>
                      <span
                        className='min-w-0 flex-1 truncate text-[var(--text-muted)] text-caption'
                        title={labelByKey.get(key) ?? o.path}
                      >
                        {labelByKey.get(key) ?? o.path}
                      </span>
                      <ChipInput
                        value={o.name}
                        onChange={(e) => setOutputName(key, e.target.value)}
                        placeholder='name'
                        className='w-[140px]'
                        maxLength={60}
                        disabled={!canManageBlock}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </SettingRow>
        </div>
      </SettingsPanel>

      <ChipConfirmModal
        open={showDelete}
        onOpenChange={() => setShowDelete(false)}
        srTitle='Delete custom block'
        title='Delete custom block'
        text={[
          'Delete ',
          { text: existing?.name ?? 'this block', bold: true },
          '? This cannot be undone.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: handleDelete,
          pending: remove.isPending,
          pendingLabel: 'Deleting...',
          disabled: confirmationText !== (existing?.name ?? ''),
        }}
      >
        {usageCount > 0 ? (
          <p className='break-words px-2 text-[var(--text-error)] text-sm'>
            {usageCount} {usageCount === 1 ? 'workflow is' : 'workflows are'} still using this block
            and will fail at run time.
          </p>
        ) : (
          <p className='break-words px-2 text-[var(--text-muted)] text-sm'>
            No workflows are currently using it.
          </p>
        )}
        <ChipModalField
          type='input'
          title={
            <span>
              Type&nbsp;
              <span className='font-medium text-[var(--text-primary)]'>{existing?.name}</span>
              &nbsp;to confirm
            </span>
          }
          value={confirmationText}
          onChange={setConfirmationText}
          placeholder={existing?.name}
        />
      </ChipConfirmModal>

      <UnsavedChangesModal
        open={guard.showUnsavedModal}
        onOpenChange={guard.setShowUnsavedModal}
        onDiscard={guard.confirmDiscard}
      />
    </>
  )
}

/** Seed the editable inputs buffer from a block's (live-derived) input fields. */
function toCustomBlockInputs(
  fields:
    | ReadonlyArray<{
        id?: string
        name: string
        type: string
        placeholder?: string
        description?: string
        required?: boolean
      }>
    | undefined
): CustomBlockInput[] {
  return (fields ?? []).map((f) => ({
    id: f.id ?? f.name,
    name: f.name,
    type: f.type,
    placeholder: f.placeholder,
    description: f.description,
    required: f.required,
  }))
}

/**
 * Compare inputs by only the authored data — the field id, placeholder, and
 * required flag. name/type/description are derived live from the deployed Start
 * (not stored), so comparing them would flag the form dirty when only Start
 * metadata drifted.
 */
function normalizeInputsForCompare(items: ReadonlyArray<Partial<CustomBlockInput>>) {
  return items.map((i) => ({
    id: i.id ?? i.name ?? '',
    placeholder: i.placeholder ?? '',
    required: i.required ?? false,
  }))
}
