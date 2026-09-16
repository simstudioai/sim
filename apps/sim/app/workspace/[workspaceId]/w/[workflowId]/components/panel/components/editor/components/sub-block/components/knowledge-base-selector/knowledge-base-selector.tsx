'use client'

import { useCallback, useMemo } from 'react'
import { ChipCombobox, ChipTag, type ComboboxOption } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { useQueries } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { PackageSearchIcon } from '@/components/icons'
import type { KnowledgeBaseData } from '@/lib/knowledge/types'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { getWorkflowSearchLabelHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
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
}

export function KnowledgeBaseSelector({
  blockId,
  subBlock,
  disabled = false,
  onKnowledgeBaseSelect,
  isPreview = false,
  previewValue,
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

  const combinedKnowledgeBases = useMemo<KnowledgeBaseData[]>(() => {
    const merged = new Map<string, KnowledgeBaseData>()
    knowledgeBases.forEach((kb) => merged.set(kb.id, kb))

    selectedKnowledgeBaseQueries.forEach((query) => {
      if (query.data) {
        merged.set(query.data.id, query.data)
      }
    })

    return Array.from(merged.values())
  }, [knowledgeBases, selectedKnowledgeBaseQueries])

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

  const labelOf = (kb: KnowledgeBaseData) => labelById.get(kb.id) ?? kb.name

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
  const handleRemoveKnowledgeBase = (knowledgeBaseId: string) => {
    if (isPreview) return

    const newSelectedIds = selectedIds.filter((id) => id !== knowledgeBaseId)
    const valueToStore = newSelectedIds.length === 1 ? newSelectedIds[0] : newSelectedIds.join(',')

    setStoreValue(valueToStore)
    onKnowledgeBaseSelect?.(newSelectedIds)
  }

  const label =
    subBlock.placeholder || (isMultiSelect ? 'Select knowledge bases' : 'Select knowledge base')

  const hasMemberScopedSelection = selectedKnowledgeBases.some(
    (kb) => kb.hasPermissionScopedConnector
  )

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
              <ChipTag
                key={kb.id}
                leftIcon={PackageSearchIcon}
                rightIcon={!disabled && !isPreview ? X : undefined}
                rightIconLabel={`Remove ${labelOf(kb)}`}
                onRightIconClick={
                  !disabled && !isPreview ? () => handleRemoveKnowledgeBase(kb.id) : undefined
                }
              >
                {formatDisplayText(labelOf(kb), { workflowSearchHighlight })}
              </ChipTag>
            )
          })}
        </div>
      )}

      <ChipCombobox
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
      {hasMemberScopedSelection && (
        <p className='mt-1.5 text-[var(--text-muted)] text-caption leading-snug'>
          Documents synced per member are returned only when the person who triggers the run has
          connected their account. Scheduled, API, webhook, and chat runs see workspace-visible
          documents only.
        </p>
      )}
    </div>
  )
}
