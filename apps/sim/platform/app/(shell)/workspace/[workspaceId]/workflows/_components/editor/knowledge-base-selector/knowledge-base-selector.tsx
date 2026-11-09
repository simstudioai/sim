'use client'

import { useMemo } from 'react'
import { IconButton } from '@sim/emcn/button'
import { Icon } from '@sim/emcn/icon'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { useActiveSearchTarget } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { formatDisplayText } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/formatted-text'
import {
  getWorkflowSearchLabelHighlight,
  isWorkflowSearchTargetForField,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import {
  ItemCard,
  ItemList,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/item-card/item-card'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/knowledge-base-selector/knowledge-base-selector.module.css'
import {
  type SubBlockConfig,
  useFolderMap,
  useSubBlockValue,
  useWorkflowScope,
} from '@/platform/lib/data/workflow-editor'
import {
  collectDuplicateNames,
  disambiguateLabelByFolder,
  type KnowledgeBaseData,
  useKnowledgeBasesList,
  useSelectedKnowledgeBases,
} from '@/platform/lib/data/workflow-editor/selectors'

const NO_IDS: string[] = []

/** A stored selection: one id, or several joined by commas. */
function readSelectedIds(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return NO_IDS
  return value.includes(',')
    ? value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
    : [value]
}

/** One id stores as itself, several as a comma-joined list. */
function storedSelection(ids: readonly string[]): string {
  return ids.length === 1 ? ids[0] : ids.join(',')
}

interface KnowledgeBaseSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: unknown
}

/**
 * Picks the knowledge base a Knowledge block reads, or several. Names that collide carry their
 * folder path, and a selection outside the workspace list still resolves through its own record. A
 * knowledge base with member-scoped sources explains which runs can see those documents.
 */
export function KnowledgeBaseSelector({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
}: KnowledgeBaseSelectorProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const { workspaceId } = useWorkflowScope()
  const { knowledgeBases, error } = useKnowledgeBasesList(workspaceId)
  const { data: knowledgeBaseFolders = {} } = useFolderMap(workspaceId, 'knowledge_base')
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlock.id)

  const value = isPreview ? previewValue : storeValue
  const isMultiSelect = subBlock.multiSelect === true
  const selectedIds = useMemo(() => readSelectedIds(value), [value])
  const selectedRecords = useSelectedKnowledgeBases(selectedIds)

  const combined = useMemo(() => {
    const merged = new Map<string, KnowledgeBaseData>()
    for (const knowledgeBase of knowledgeBases) merged.set(knowledgeBase.id, knowledgeBase)
    for (const record of selectedRecords) merged.set(record.id, record)
    return [...merged.values()]
  }, [knowledgeBases, selectedRecords])

  // Rows and selected chips share one label pass, so they can never disagree.
  const { options, labelById } = useMemo(() => {
    const duplicateNames = collectDuplicateNames(
      combined.map((knowledgeBase) => knowledgeBase.name)
    )
    const labels = new Map<string, string>()
    const rows = combined.map((knowledgeBase) => {
      const label = disambiguateLabelByFolder(
        knowledgeBase.name,
        knowledgeBase.folderId,
        knowledgeBaseFolders,
        duplicateNames
      )
      labels.set(knowledgeBase.id, label)
      return { value: knowledgeBase.id, label, leading: <Icon name='I082' /> }
    })
    return { options: rows, labelById: labels }
  }, [combined, knowledgeBaseFolders])

  const byId = useMemo(
    () => new Map(combined.map((knowledgeBase) => [knowledgeBase.id, knowledgeBase])),
    [combined]
  )
  const selected = selectedIds
    .map((id) => byId.get(id))
    .filter((knowledgeBase): knowledgeBase is KnowledgeBaseData => Boolean(knowledgeBase))
  const labelOf = (knowledgeBase: KnowledgeBaseData) =>
    labelById.get(knowledgeBase.id) ?? knowledgeBase.name
  const editable = !disabled && !isPreview
  const label =
    subBlock.title || subBlock.placeholder || (isMultiSelect ? 'Knowledge bases' : 'Knowledge base')
  const placeholder =
    subBlock.placeholder || (isMultiSelect ? 'Select knowledge bases' : 'Select knowledge base')
  const searchMatch = isWorkflowSearchTargetForField({
    activeSearchTarget,
    blockId,
    subBlockId: subBlock.id,
    valuePath: isMultiSelect ? (activeSearchTarget?.valuePath ?? []) : [],
  })
  const memberScoped = selected.some((knowledgeBase) => knowledgeBase.hasPermissionScopedConnector)

  return (
    <div className={styles.selector}>
      {isMultiSelect && selected.length > 0 && (
        <ItemList label={`Selected ${label.toLowerCase()}`}>
          {selected.map((knowledgeBase, index) => (
            <li key={knowledgeBase.id}>
              <ItemCard
                icon='I082'
                name={formatDisplayText(labelOf(knowledgeBase), {
                  workflowSearchHighlight: getWorkflowSearchLabelHighlight({
                    activeSearchTarget,
                    blockId,
                    subBlockId: subBlock.id,
                    valuePath: [index],
                    label: labelOf(knowledgeBase),
                  }),
                })}
                title={labelOf(knowledgeBase)}
                expandable={false}
                expanded={false}
                actions={
                  editable && (
                    <IconButton
                      label={`Remove ${labelOf(knowledgeBase)}`}
                      icon='I105'
                      size='compact'
                      onClick={() =>
                        setStoreValue(
                          storedSelection(selectedIds.filter((id) => id !== knowledgeBase.id))
                        )
                      }
                    />
                  )
                }
              />
            </li>
          ))}
        </ItemList>
      )}
      <div className={styles.picker} data-search-match={searchMatch || undefined}>
        {isMultiSelect ? (
          <MultiSelect
            label={label}
            labelHidden
            options={options}
            value={selectedIds}
            selectedLabels={Object.fromEntries(labelById)}
            onValueChange={(ids) => {
              if (editable) setStoreValue(storedSelection(ids))
            }}
            placeholder={placeholder}
            searchLabel='Search knowledge bases...'
            error={error ?? undefined}
            disabled={!editable}
          />
        ) : (
          <SearchableSelect
            label={label}
            labelHidden
            options={options}
            value={selectedIds[0] ?? null}
            selectedLabel={selected[0] ? labelOf(selected[0]) : selectedIds[0]}
            selectedLeading={selectedIds[0] ? <Icon name='I082' /> : undefined}
            onValueChange={(next) => {
              if (editable && next !== null) setStoreValue(next)
            }}
            placeholder={placeholder}
            searchLabel='Search knowledge bases...'
            error={error ?? undefined}
            disabled={!editable}
          />
        )}
      </div>
      {memberScoped && (
        <p className={styles.note} data-type='T052'>
          Documents synced per member are returned only when the person who triggers the run has
          connected their account. Scheduled, API, webhook, and chat runs see workspace-visible
          documents only.
        </p>
      )}
    </div>
  )
}
