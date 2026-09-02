'use client'

import { useCallback, useMemo } from 'react'
import { Combobox, type ComboboxOption } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { useQueries } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { PackageSearchIcon } from '@/components/icons'
import { ROOT_FOLDER_PATH } from '@/lib/folders/paths'
import { collectFolderDepths } from '@/lib/folders/subtree'
import type { KnowledgeBaseData } from '@/lib/knowledge/types'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { readFolderPath } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/sim-folder-tree-selector/selection'
import { getWorkflowSearchLabelHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useResourceFolders } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-resource-folders'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import type { SubBlockConfig } from '@/blocks/types'
import { useKnowledgeBasesList } from '@/hooks/kb/use-knowledge'
import { useFolderMap } from '@/hooks/queries/folders'
import { fetchKnowledgeBase, KNOWLEDGE_BASE_DETAIL_STALE_TIME } from '@/hooks/queries/kb/knowledge'
import { collectDuplicateNames, disambiguateLabelByFolder } from '@/hooks/queries/utils/folder-tree'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'

interface KnowledgeBaseSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  onKnowledgeBaseSelect?: (knowledgeBaseId: string | string[]) => void
  isPreview?: boolean
  previewValue?: string | null
  /**
   * A sibling folder field that narrows what this picker offers, and the switch
   * saying whether that scope descends. See `SubBlockConfig.folderScope`.
   */
  folderScope?: NonNullable<SubBlockConfig['folderScope']>
}

export function KnowledgeBaseSelector({
  blockId,
  subBlock,
  disabled = false,
  onKnowledgeBaseSelect,
  isPreview = false,
  previewValue,
  folderScope,
}: KnowledgeBaseSelectorProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const {
    knowledgeBases,
    isLoading: isKnowledgeBasesLoading,
    error,
  } = useKnowledgeBasesList(workspaceId)

  const { data: knowledgeBaseFolders = {} } = useFolderMap(workspaceId, 'knowledge_base')

  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)

  const value = isPreview ? previewValue : storeValue

  const isMultiSelect = subBlock.multiSelect === true

  /**
   * Parse value into array of selected IDs
   */
  const selectedIds = useMemo(() => {
    if (!value) return []
    if (typeof value === 'string') {
      return value.includes(',')
        ? value
            .split(',')
            .map((id) => id.trim())
            .filter((id) => id.length > 0)
        : [value]
    }
    return []
  }, [value])

  /**
   * Convert knowledge bases to combobox options format
   */
  const selectedKnowledgeBaseQueries = useQueries({
    queries: selectedIds.map((selectedId) => ({
      queryKey: knowledgeKeys.detail(selectedId),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchKnowledgeBase(selectedId, signal),
      enabled: Boolean(selectedId),
      staleTime: KNOWLEDGE_BASE_DETAIL_STALE_TIME,
    })),
  })

  /*
   * A sibling folder field narrows what this picker offers. Choosing a folder
   * means the run only searches that folder, so listing knowledge bases from
   * anywhere else would let a selection be built that the operation then
   * ignores — the picker has to describe the same set the run will read.
   *
   * Falling back to this control's own id keeps the hook call unconditional for
   * a picker with no folder scope; its own value is never a folder path, so the
   * scope reads as absent.
   */
  const resourceFolders = useResourceFolders(workspaceId, 'knowledge_base')
  const [folderScopeValue] = useSubBlockValue<unknown>(blockId, folderScope?.fieldId ?? subBlock.id)
  /*
   * The advanced half of the same canonical pair. Only one half is ever filled —
   * whichever mode the field is in — so reading just the basic id would see an
   * empty value for an advanced-mode user and drop the scope entirely.
   */
  const [manualFolderScopeValue] = useSubBlockValue<unknown>(
    blockId,
    folderScope?.manualFieldId ?? folderScope?.fieldId ?? subBlock.id
  )
  const [folderScopeRecursive] = useSubBlockValue<unknown>(
    blockId,
    folderScope?.recursiveFieldId ?? subBlock.id
  )
  /*
   * `readFolderPath` is the shared parser the block's own params transformer
   * uses. Reading the raw string here instead would miss the legacy array and
   * JSON-array forms a persisted value can still take, and the picker would
   * then scope differently from the run.
   */
  const folderScopePath = folderScope
    ? readFolderPath(folderScopeValue) || readFolderPath(manualFolderScopeValue)
    : ''
  const folderScopeIncludesSubfolders =
    folderScopeRecursive === true || folderScopeRecursive === 'true'

  /**
   * The folder ids the scope covers, walked through `parentId` rather than
   * compared as path strings — a folder genuinely named `Q3/Q4` is one level in
   * either spelling and only a parent walk sees that. An unresolvable path
   * covers nothing, which reads as an empty picker rather than an unfiltered
   * one.
   */
  const folderScopeState = useMemo(():
    | { kind: 'none' }
    | { kind: 'pending' }
    | { kind: 'unresolved' }
    | { kind: 'resolved'; ids: Set<string> } => {
    if (!folderScopePath || folderScopePath === ROOT_FOLDER_PATH) return { kind: 'none' }
    /*
     * Loading is not the same as empty. The knowledge-base query can resolve
     * while the folder query is still in flight, and treating that window as an
     * empty scope makes every selection look out of scope — which the cleanup
     * below would act on and erase.
     */
    if (resourceFolders.isLoading) return { kind: 'pending' }
    const root = resourceFolders.byPath.get(folderScopePath)
    if (!root) return { kind: 'unresolved' }
    const ids = new Set<string>([root.id])
    if (folderScopeIncludesSubfolders) {
      for (const id of collectFolderDepths(resourceFolders.folders, root.id).keys()) ids.add(id)
    }
    return { kind: 'resolved', ids }
  }, [folderScopePath, folderScopeIncludesSubfolders, resourceFolders])

  /**
   * Whether a knowledge base survives the folder scope.
   *
   * `pending` offers everything rather than flashing an empty picker while the
   * folder query lands; `unresolved` offers nothing, because a path that names
   * no folder selects no knowledge bases.
   */
  const isInFolderScope = useCallback(
    (knowledgeBase: { folderId: string | null }) => {
      switch (folderScopeState.kind) {
        case 'none':
        case 'pending':
          return true
        case 'unresolved':
          return false
        case 'resolved':
          return knowledgeBase.folderId !== null && folderScopeState.ids.has(knowledgeBase.folderId)
      }
    },
    [folderScopeState]
  )

  const combinedKnowledgeBases = useMemo<KnowledgeBaseData[]>(() => {
    const merged = new Map<string, KnowledgeBaseData>()
    knowledgeBases.forEach((kb) => {
      if (isInFolderScope(kb)) merged.set(kb.id, kb)
    })

    /*
     * An already-chosen knowledge base stays listed even when the folder scope
     * excludes it, or its chip loses its label. It is not silently dropped
     * either: a picked knowledge base is what the run searches, the card
     * sentence names it, and the Folder field says so.
     */
    selectedKnowledgeBaseQueries.forEach((query) => {
      if (query.data) {
        merged.set(query.data.id, query.data)
      }
    })

    return Array.from(merged.values())
  }, [knowledgeBases, selectedKnowledgeBaseQueries, isInFolderScope])

  /**
   * Display names, with the folder path appended when two knowledge bases share
   * a name — otherwise the dropdown rows and the selected chips are
   * indistinguishable from one another. Built in the same pass as the options so
   * the chips and the dropdown can never disagree.
   */
  const { options, labelById } = useMemo(() => {
    const duplicateNames = collectDuplicateNames(combinedKnowledgeBases.map((kb) => kb.name))
    const labelById = new Map<string, string>()
    const options: ComboboxOption[] = combinedKnowledgeBases.map((kb) => {
      const label = disambiguateLabelByFolder(
        kb.name,
        kb.folderId,
        knowledgeBaseFolders,
        duplicateNames
      )
      labelById.set(kb.id, label)
      return { label, value: kb.id, icon: PackageSearchIcon }
    })
    return { options, labelById }
  }, [combinedKnowledgeBases, knowledgeBaseFolders])

  const labelOf = useCallback(
    (kb: KnowledgeBaseData) => labelById.get(kb.id) ?? kb.name,
    [labelById]
  )

  /**
   * Compute selected knowledge bases for tag display
   */
  const selectedKnowledgeBases = useMemo<KnowledgeBaseData[]>(() => {
    if (selectedIds.length === 0) return []

    const lookup = new Map<string, KnowledgeBaseData>()
    combinedKnowledgeBases.forEach((kb) => {
      lookup.set(kb.id, kb)
    })

    return selectedIds
      .map((id) => lookup.get(id))
      .filter((kb): kb is KnowledgeBaseData => Boolean(kb))
  }, [selectedIds, combinedKnowledgeBases])

  /**
   * Handle single selection
   */
  const handleChange = useCallback(
    (selectedValue: string) => {
      if (isPreview) return

      setStoreValue(selectedValue)
      onKnowledgeBaseSelect?.(selectedValue)
    },
    [isPreview, setStoreValue, onKnowledgeBaseSelect]
  )

  /**
   * Handle multi-select changes
   */
  const handleMultiSelectChange = useCallback(
    (values: string[]) => {
      if (isPreview) return

      const valueToStore = values.length === 1 ? values[0] : values.join(',')
      setStoreValue(valueToStore)
      onKnowledgeBaseSelect?.(values)
    },
    [isPreview, setStoreValue, onKnowledgeBaseSelect]
  )

  /**
   * Remove selected knowledge base from multi-select tags
   */
  const handleRemoveKnowledgeBase = useCallback(
    (knowledgeBaseId: string) => {
      if (isPreview) return

      const newSelectedIds = selectedIds.filter((id) => id !== knowledgeBaseId)
      const valueToStore =
        newSelectedIds.length === 1 ? newSelectedIds[0] : newSelectedIds.join(',')

      setStoreValue(valueToStore)
      onKnowledgeBaseSelect?.(newSelectedIds)
    },
    [isPreview, selectedIds, setStoreValue, onKnowledgeBaseSelect]
  )

  const label =
    subBlock.placeholder || (isMultiSelect ? 'Select knowledge bases' : 'Select knowledge base')

  return (
    <div className='w-full'>
      {/* Selected knowledge bases display (for multi-select) */}
      {isMultiSelect && selectedKnowledgeBases.length > 0 && (
        <div className='mb-2 flex flex-wrap gap-1'>
          {selectedKnowledgeBases.map((kb, index) => {
            const workflowSearchHighlight = getWorkflowSearchLabelHighlight({
              activeSearchTarget,
              blockId,
              subBlockId: subBlock.id,
              valuePath: [index],
              label: labelOf(kb),
            })
            return (
              <div
                key={kb.id}
                className='inline-flex items-center rounded-md border border-[color-mix(in_srgb,var(--brand-knowledge)_20%,transparent)] bg-[color-mix(in_srgb,var(--brand-knowledge)_10%,transparent)] px-2 py-1 text-xs'
              >
                <PackageSearchIcon className='mr-1 size-3 text-[var(--brand-knowledge)]' />
                <span className='text-[var(--brand-knowledge)]'>
                  {formatDisplayText(labelOf(kb), { workflowSearchHighlight })}
                </span>
                {!disabled && !isPreview && (
                  <button
                    type='button'
                    onClick={() => handleRemoveKnowledgeBase(kb.id)}
                    className='ml-1 text-[color-mix(in_srgb,var(--brand-knowledge)_60%,transparent)] hover-hover:text-[var(--brand-knowledge)]'
                    aria-label={`Remove ${labelOf(kb)}`}
                  >
                    <X className='size-3' />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Combobox
        options={options}
        value={isMultiSelect ? undefined : (selectedIds[0] ?? '')}
        multiSelect={isMultiSelect}
        multiSelectValues={isMultiSelect ? selectedIds : undefined}
        onChange={handleChange}
        onMultiSelectChange={handleMultiSelectChange}
        placeholder={label}
        disabled={disabled || isPreview}
        isLoading={isKnowledgeBasesLoading}
        error={error}
        searchable
        searchPlaceholder='Search knowledge bases...'
        overlayContent={
          !isMultiSelect && selectedKnowledgeBases[0]
            ? (() => {
                const workflowSearchHighlight = getWorkflowSearchLabelHighlight({
                  activeSearchTarget,
                  blockId,
                  subBlockId: subBlock.id,
                  valuePath: [],
                  label: labelOf(selectedKnowledgeBases[0]),
                })
                return workflowSearchHighlight ? (
                  <span className='truncate text-[var(--text-primary)]'>
                    {formatDisplayText(labelOf(selectedKnowledgeBases[0]), {
                      workflowSearchHighlight,
                    })}
                  </span>
                ) : undefined
              })()
            : undefined
        }
      />
    </div>
  )
}
