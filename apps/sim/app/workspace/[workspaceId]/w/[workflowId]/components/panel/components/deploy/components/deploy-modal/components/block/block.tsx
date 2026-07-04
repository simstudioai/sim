'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  ChipCombobox,
  ChipInput,
  ChipTextarea,
  type ComboboxOptionGroup,
  Loader,
  toast,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { Image as ImageIcon, X } from 'lucide-react'
import {
  type FlattenOutputsBlockInput,
  type FlattenOutputsEdgeInput,
  flattenWorkflowOutputs,
} from '@/lib/workflows/blocks/flatten-outputs'
import { DropZone } from '@/app/workspace/[workspaceId]/components/drop-zone'
import { useProfilePictureUpload } from '@/app/workspace/[workspaceId]/settings/hooks/use-profile-picture-upload'
import type { CustomBlockOutput } from '@/blocks/custom/build-config'
import { SettingRow } from '@/ee/components/setting-row'
import {
  useCustomBlocks,
  useDeleteCustomBlock,
  usePublishCustomBlock,
  useUpdateCustomBlock,
} from '@/hooks/queries/custom-blocks'
import { useDeployedWorkflowState } from '@/hooks/queries/deployments'

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

interface BlockDeployProps {
  workflowId: string | null
  workspaceId: string
  isDeployed: boolean
  canAdmin: boolean
  /** Lifted state so the modal footer (shared with the other tabs) owns the actions. */
  onSubmittingChange?: (submitting: boolean) => void
  onCanSaveChange?: (canSave: boolean) => void
  onExistingChange?: (existing: boolean) => void
}

export function BlockDeploy({
  workflowId,
  workspaceId,
  isDeployed,
  canAdmin,
  onSubmittingChange,
  onCanSaveChange,
  onExistingChange,
}: BlockDeployProps) {
  const { data: customBlocks = [] } = useCustomBlocks(workspaceId)
  const existing = useMemo(
    () => customBlocks.find((b) => b.workflowId === workflowId) ?? null,
    [customBlocks, workflowId]
  )

  const publish = usePublishCustomBlock(workspaceId)
  const update = useUpdateCustomBlock(workspaceId)
  const remove = useDeleteCustomBlock(workspaceId)

  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  /** Curated outputs (with editable names); empty = expose the whole result. */
  const [outputs, setOutputs] = useState<CustomBlockOutput[]>(() => existing?.exposedOutputs ?? [])
  const [error, setError] = useState<string | null>(null)

  // `existing` arrives async from useCustomBlocks; the useState seeds above only run
  // on first render. Reseed when the resolved block identity changes (nothing →
  // loaded, or unpublish → nothing) so the form reflects real data instead of
  // staying empty and offering a duplicate publish. Keyed on the id (stable across
  // refetches) so it never clobbers in-progress edits.
  const existingId = existing?.id ?? null
  const prevExistingIdRef = useRef(existingId)
  if (prevExistingIdRef.current !== existingId) {
    prevExistingIdRef.current = existingId
    setName(existing?.name ?? '')
    setDescription(existing?.description ?? '')
    setOutputs(existing?.exposedOutputs ?? [])
  }

  const iconUpload = useProfilePictureUpload({
    currentImage: existing?.iconUrl ?? null,
    onError: (e) => setError(e),
    context: 'workspace-logos',
    workspaceId,
  })

  // Curate outputs from the DEPLOYED state — the block always runs the latest
  // deployment, so draft-only blocks must not appear as pickable outputs (they'd
  // resolve to `undefined` at runtime).
  const workflowState = useDeployedWorkflowState(workflowId ?? null)
  const { outputGroups, labelByKey } = useMemo(() => {
    const state = workflowState.data as
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
    const groups = Array.from(byBlock.values()).map((g) => ({
      section: g.blockName,
      items: g.items,
    }))
    return { outputGroups: groups, labelByKey: labels }
  }, [workflowState.data])

  /** Curated outputs that still resolve to a block in the (loaded) workflow. An
   *  output whose block was deleted no longer appears here, so it is neither shown
   *  nor saved. While the workflow is still loading we keep every stored output to
   *  avoid dropping valid ones before their blocks are known. */
  const outputsLoaded = Boolean(workflowState.data) && !workflowState.isLoading
  const visibleOutputs = useMemo(
    () =>
      outputsLoaded
        ? outputs.filter((o) => labelByKey.has(encodeOutput(o.blockId, o.path)))
        : outputs,
    [outputs, outputsLoaded, labelByKey]
  )

  const selectedOutputKeys = useMemo(
    () => visibleOutputs.map((o) => encodeOutput(o.blockId, o.path)),
    [visibleOutputs]
  )

  /** Reconcile the picker's selection: keep existing rows (and their names), add
   *  new picks with a derived default name, drop removed ones. */
  function handleOutputsChange(nextKeys: string[]) {
    const byKey = new Map(outputs.map((o) => [encodeOutput(o.blockId, o.path), o]))
    const taken = new Set(outputs.map((o) => o.name))
    setOutputs(
      nextKeys.map((key) => {
        const existingOutput = byKey.get(key)
        if (existingOutput) return existingOutput
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

  const iconUrl = iconUpload.previewUrl
  const isBusy = publish.isPending || update.isPending || remove.isPending

  // Only enable "Update" when something actually changed (clear feedback on what
  // needs saving); publishing a new block just needs a name.
  const dirty = existing
    ? name.trim() !== existing.name ||
      description.trim() !== (existing.description ?? '') ||
      (iconUrl || null) !== (existing.iconUrl ?? null) ||
      JSON.stringify(visibleOutputs) !== JSON.stringify(existing.exposedOutputs)
    : true

  const canSave = canAdmin && name.trim().length > 0 && !isBusy && !iconUpload.isUploading && dirty

  useEffect(() => onCanSaveChange?.(canSave), [canSave, onCanSaveChange])
  useEffect(
    () => onSubmittingChange?.(publish.isPending || update.isPending),
    [publish.isPending, update.isPending, onSubmittingChange]
  )
  useEffect(() => onExistingChange?.(Boolean(existing)), [existing, onExistingChange])

  async function handleSubmit() {
    setError(null)
    const exposedOutputs = visibleOutputs.map((o) => ({ ...o, name: o.name.trim() }))
    if (exposedOutputs.some((o) => !o.name)) {
      setError('Every exposed output needs a name')
      return
    }
    if (new Set(exposedOutputs.map((o) => o.name)).size !== exposedOutputs.length) {
      setError('Output names must be unique')
      return
    }
    try {
      if (existing) {
        const iconChanged = (iconUrl || null) !== (existing.iconUrl ?? null)
        await update.mutateAsync({
          id: existing.id,
          name: name.trim(),
          description: description.trim(),
          exposedOutputs,
          ...(iconChanged ? { iconUrl: iconUrl || null } : {}),
        })
        toast.success('Block updated')
      } else {
        if (!workflowId) return
        await publish.mutateAsync({
          workspaceId,
          workflowId,
          name: name.trim(),
          description: description.trim(),
          exposedOutputs,
          ...(iconUrl ? { iconUrl } : {}),
        })
        toast.success('Published as block')
      }
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to save block'))
    }
  }

  async function handleUnpublish() {
    if (!existing) return
    setError(null)
    try {
      await remove.mutateAsync(existing.id)
      setName('')
      setDescription('')
      setOutputs([])
      iconUpload.handleRemove()
      toast.success('Block unpublished')
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to unpublish block'))
    }
  }

  if (!isDeployed && !existing) {
    return (
      <div className='py-6 text-center text-[var(--text-muted)] text-small'>
        Deploy this workflow first to publish it as a block.
      </div>
    )
  }

  return (
    <form
      id='block-deploy-form'
      onSubmit={(e) => {
        e.preventDefault()
        handleSubmit()
      }}
      className='flex flex-col gap-5 py-1'
    >
      {/* Triggered by the modal footer's Unpublish button (mirrors the chat tab). */}
      <button type='button' data-unpublish-trigger className='hidden' onClick={handleUnpublish} />
      {error && (
        <div className='rounded-md border border-[color-mix(in_srgb,var(--text-error)_20%,transparent)] bg-[color-mix(in_srgb,var(--text-error)_10%,transparent)] px-3 py-2 text-[var(--text-error)] text-small'>
          {error}
        </div>
      )}

      <SettingRow label='Icon' labelTooltip='Square image (PNG, JPEG, or SVG). Optional.'>
        <div className='flex items-center gap-4'>
          <DropZone onDrop={iconUpload.handleFileDrop}>
            <button
              type='button'
              onClick={iconUpload.handleThumbnailClick}
              disabled={!canAdmin || iconUpload.isUploading}
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
              disabled={!canAdmin || iconUpload.isUploading}
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
                disabled={!canAdmin || iconUpload.isUploading}
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
          disabled={!canAdmin}
        />
      </SettingRow>

      <SettingRow label='Description'>
        <ChipTextarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder='What this block does'
          rows={2}
          maxLength={280}
          disabled={!canAdmin}
        />
      </SettingRow>

      <SettingRow label='Outputs'>
        <ChipCombobox
          multiSelect
          searchable
          searchPlaceholder='Search outputs…'
          className='w-full'
          dropdownWidth='trigger'
          maxHeight={280}
          disabled={!canAdmin || workflowState.isLoading || outputGroups.length === 0}
          emptyMessage={workflowState.isLoading ? 'Loading workflow…' : 'No outputs found.'}
          options={[]}
          groups={outputGroups}
          multiSelectValues={selectedOutputKeys}
          onMultiSelectChange={handleOutputsChange}
          overlayContent={
            <span className='truncate text-[var(--text-primary)]'>
              {visibleOutputs.length === 0
                ? 'All outputs (result)'
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
                    disabled={!canAdmin}
                  />
                </div>
              )
            })}
          </div>
        )}
      </SettingRow>

      {!canAdmin && (
        <p className='text-[var(--text-muted)] text-caption'>Admin permissions required</p>
      )}
    </form>
  )
}
