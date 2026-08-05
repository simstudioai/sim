'use client'

import { type ReactNode, useMemo } from 'react'
import {
  Button,
  ChipDropdown,
  type ChipDropdownOption,
  cellIconNodeClass,
  chipContentGap,
  chipContentLabelClass,
  chipVariants,
  cn,
  Loader,
  Tooltip,
} from '@sim/emcn'
import { DatabaseX } from '@sim/emcn/icons'
import { format } from 'date-fns'
import { getDocumentIcon } from '@/components/icons/document-icons'
import {
  type FilterTag,
  FloatingOverflowText,
  type PaginationConfig,
  Resource,
  type ResourceCell,
  type ResourceColumn,
  type ResourceRow,
  type SelectableConfig,
  type SortConfig,
} from '@/components/resource'
import { DocumentTagsCell } from '@/components/resources/knowledge-view/components/document-tags-cell'
import { SearchHighlight } from '@/components/resources/knowledge-view/components/search-highlight'
import {
  AutoWidthPanel,
  FILTER_SECTION_LABEL_CLASS,
  type TagFilterEntry,
  TagFilterSection,
} from '@/components/resources/knowledge-view/components/tag-filter-panel'
import {
  getDocumentTags,
  getStatusBadge,
} from '@/components/resources/knowledge-view/utils/document-rows'
import type { DocumentData } from '@/lib/knowledge/types'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import type { TagDefinition } from '@/hooks/kb/use-knowledge-base-tag-definitions'
import type { ConnectorData } from '@/hooks/queries/kb/connectors'
import type { ResourceGrants, ResourceHost, ResourceSource } from '@/resources'

const DOCUMENT_COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name', widthMultiplier: 0.8 },
  { id: 'size', header: 'Size', widthMultiplier: 0.75 },
  { id: 'tokens', header: 'Tokens', widthMultiplier: 0.75 },
  { id: 'chunks', header: 'Chunks', widthMultiplier: 0.75 },
  { id: 'uploaded', header: 'Uploaded' },
  { id: 'status', header: 'Status', widthMultiplier: 0.75 },
  { id: 'tags', header: 'Tags' },
]

const STATUS_FILTER_OPTIONS: ChipDropdownOption[] = [
  { value: 'all', label: 'All' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
]

/** Sortable document columns, labelled as the sort menu shows them. */
const SORT_OPTIONS: SortConfig['options'] = [
  { id: 'filename', label: 'Name' },
  { id: 'fileSize', label: 'Size' },
  { id: 'tokenCount', label: 'Tokens' },
  { id: 'chunkCount', label: 'Chunks' },
  { id: 'uploadedAt', label: 'Uploaded' },
  { id: 'enabled', label: 'Status' },
]

/** The three buckets the status filter offers. */
export type KnowledgeEnabledFilter = 'all' | 'enabled' | 'disabled'

/**
 * The document list as the host resolved it: the rows themselves, the
 * definitions the tag column and tag filters read, and the view-state driving
 * the query behind them.
 *
 * The state lives on the host rather than in the view because it decides where
 * it is stored: a host that owns the URL keeps `q` / `enabled` / `sort` / `dir`
 * / `page` as query params, while an embedded one keeps the same values locally
 * so they never reach its address bar. That is exactly the decision
 * `hostOwnsUrl(host)` expresses.
 */
export interface KnowledgeDocumentList {
  documents: DocumentData[]
  tagDefinitions: TagDefinition[]
  connectors: ConnectorData[]
  /** The knowledge base itself could not be resolved — the view shows the unavailable state. */
  unavailable: boolean
  search: string
  onSearchChange: (value: string) => void
  /** The search text used for match highlighting: always the trimmed query. */
  highlightQuery: string
  enabledFilter: KnowledgeEnabledFilter
  onEnabledFilterChange: (value: KnowledgeEnabledFilter) => void
  tagFilterEntries: TagFilterEntry[]
  onTagFilterEntriesChange: (entries: TagFilterEntry[]) => void
  /** Sort state and handlers; the column list itself is the view's own. */
  sort: Omit<SortConfig, 'options'>
  pagination: PaginationConfig
}

/**
 * Row-level affordances owned by the host's write path — selecting documents for
 * a bulk operation, the row context menu, and the action bar those drive. A host
 * with no write path (a future share surface) simply omits them and the list
 * renders as a plain reading surface.
 */
export interface KnowledgeViewInteraction {
  selection?: Omit<SelectableConfig, 'disabled'>
  overlay?: ReactNode
  onRowClick?: (documentId: string) => void
  onRowContextMenu?: (e: React.MouseEvent, documentId: string) => void
  /** Opens the host's connected-sources surface from a connector badge. */
  onConnectorSelect?: () => void
}

export interface KnowledgeViewProps {
  source: ResourceSource<'knowledge'>
  grants: ResourceGrants
  /**
   * Declared because every view is mounted against all three axes, and inert in
   * the read surface today: the document list draws the same chrome on a page
   * and in a panel. Its URL half is what matters here — who may write the
   * document-list query params — and that is settled by the host when it builds
   * {@link KnowledgeDocumentList}, via `hostOwnsUrl`.
   */
  host: ResourceHost
  list: KnowledgeDocumentList
  interaction?: KnowledgeViewInteraction
}

/**
 * The knowledge base read surface: the document list with its search, status and
 * tag filters, sort, pagination, and the state shown when the base itself is
 * gone.
 *
 * It renders the body of a {@link Resource} shell — the options toolbar and the
 * table — so the host keeps ownership of the header (breadcrumbs, rename, the
 * new-document and new-connector actions) alongside every mutation those drive.
 */
export function KnowledgeView({ source, grants, list, interaction }: KnowledgeViewProps) {
  const {
    documents,
    tagDefinitions,
    connectors,
    unavailable,
    search,
    onSearchChange,
    highlightQuery,
    enabledFilter,
    onEnabledFilterChange,
    tagFilterEntries,
    onTagFilterEntriesChange,
    sort,
    pagination,
  } = list

  const filterContent = useMemo(
    () => (
      <AutoWidthPanel>
        <div className='flex flex-col gap-2'>
          <div className='flex h-5 items-center justify-between'>
            <span className={FILTER_SECTION_LABEL_CLASS}>Status</span>
            {enabledFilter !== 'all' && (
              <Button
                variant='ghost'
                onClick={() => onEnabledFilterChange('all')}
                className='-mr-1 h-auto px-1 py-0.5 text-[var(--text-muted)] text-caption hover-hover:text-[var(--text-secondary)]'
              >
                Clear
              </Button>
            )}
          </div>
          <ChipDropdown
            options={STATUS_FILTER_OPTIONS}
            value={enabledFilter}
            onChange={(value) => {
              if (value !== 'all' && value !== 'enabled' && value !== 'disabled') return
              onEnabledFilterChange(value)
            }}
            align='start'
            fullWidth
          />
        </div>
        <TagFilterSection
          tagDefinitions={tagDefinitions}
          entries={tagFilterEntries}
          onChange={onTagFilterEntriesChange}
        />
      </AutoWidthPanel>
    ),
    [
      enabledFilter,
      onEnabledFilterChange,
      tagDefinitions,
      tagFilterEntries,
      onTagFilterEntriesChange,
    ]
  )

  const connectorBadges =
    connectors.length > 0 ? (
      <>
        {connectors.map((connector) => {
          const def = CONNECTOR_META_REGISTRY[connector.connectorType]
          const ConnectorIcon = def?.icon
          return (
            <button
              key={connector.id}
              type='button'
              onClick={interaction?.onConnectorSelect}
              className={cn(chipVariants({ variant: 'filled' }), 'max-w-[180px]')}
            >
              <span className='relative flex size-[14px] flex-shrink-0 items-center justify-center'>
                {connector.status === 'syncing' ? (
                  <Loader className='size-[14px]' animate />
                ) : (
                  ConnectorIcon && <ConnectorIcon className='size-[14px]' />
                )}
                {connector.status !== 'active' && connector.status !== 'syncing' && (
                  <span
                    className={cn(
                      '-right-0.5 -top-0.5 absolute size-1.5 rounded-xs border border-[var(--surface-2)]',
                      connector.status === 'error'
                        ? 'bg-[var(--text-error)]'
                        : connector.status === 'disabled'
                          ? 'bg-[var(--caution)]'
                          : 'bg-[var(--text-muted)]'
                    )}
                  />
                )}
              </span>
              <span className='truncate text-[var(--text-body)]'>
                {def?.name || connector.connectorType}
              </span>
            </button>
          )
        })}
      </>
    ) : null

  const filterTags: FilterTag[] = useMemo(
    () => [
      ...(enabledFilter !== 'all'
        ? [
            {
              label: `Status: ${enabledFilter === 'enabled' ? 'Enabled' : 'Disabled'}`,
              onRemove: () => onEnabledFilterChange('all'),
            },
          ]
        : []),
      ...tagFilterEntries.reduce<FilterTag[]>((acc, f) => {
        if (!f.tagSlot || !f.value.trim()) return acc
        acc.push({
          label: `${f.tagName}: ${f.value}`,
          onRemove: () => onTagFilterEntriesChange(tagFilterEntries.filter((e) => e.id !== f.id)),
        })
        return acc
      }, []),
    ],
    [enabledFilter, onEnabledFilterChange, tagFilterEntries, onTagFilterEntriesChange]
  )

  const sortConfig: SortConfig = useMemo(() => ({ options: SORT_OPTIONS, ...sort }), [sort])

  const selectableConfig: SelectableConfig | undefined = useMemo(
    () =>
      interaction?.selection ? { ...interaction.selection, disabled: !grants.write } : undefined,
    [interaction?.selection, grants.write]
  )

  const documentRows: ResourceRow[] = useMemo(
    () =>
      documents.map((doc) => {
        const ConnectorIcon = doc.connectorType
          ? CONNECTOR_META_REGISTRY[doc.connectorType]?.icon
          : null
        const DocIcon = ConnectorIcon || getDocumentIcon(doc.mimeType, doc.filename)

        const tags = getDocumentTags(doc, tagDefinitions)

        const statusCell: ResourceCell =
          doc.processingStatus === 'failed' && doc.processingError
            ? {
                content: (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <div className='cursor-help'>{getStatusBadge(doc)}</div>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='top' className='max-w-xs'>
                      {doc.processingError}
                    </Tooltip.Content>
                  </Tooltip.Root>
                ),
              }
            : { content: getStatusBadge(doc) }

        const tagsCell: ResourceCell =
          tags.length === 0 ? { label: null } : { content: <DocumentTagsCell tags={tags} /> }

        return {
          id: doc.id,
          cells: {
            name: {
              content: (
                <span className={cn('flex min-w-0 items-center', chipContentGap)}>
                  <span className={cellIconNodeClass}>
                    <DocIcon className='size-[14px]' />
                  </span>
                  <FloatingOverflowText
                    label={doc.filename}
                    className={cn('block', chipContentLabelClass)}
                  >
                    <SearchHighlight text={doc.filename} searchQuery={highlightQuery} />
                  </FloatingOverflowText>
                </span>
              ),
            },
            size: { label: formatFileSize(doc.fileSize) },
            tokens: {
              label:
                doc.processingStatus === 'completed'
                  ? doc.tokenCount > 1000
                    ? `${(doc.tokenCount / 1000).toFixed(1)}k`
                    : doc.tokenCount.toLocaleString()
                  : null,
            },
            chunks: {
              label: doc.processingStatus === 'completed' ? doc.chunkCount.toLocaleString() : null,
            },
            uploaded: {
              content: (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <span className='font-medium text-[var(--text-secondary)] text-sm'>
                      {format(new Date(doc.uploadedAt), 'MMM d')}
                    </span>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>
                    {format(new Date(doc.uploadedAt), 'MMM d, yyyy h:mm a')}
                  </Tooltip.Content>
                </Tooltip.Root>
              ),
            },
            status: statusCell,
            tags: tagsCell,
          },
        }
      }),
    [documents, tagDefinitions, highlightQuery]
  )

  if (unavailable) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3'>
        <DatabaseX className='size-[32px] text-[var(--text-muted)]' />
        <div className='flex flex-col items-center gap-1'>
          <h2 className='font-medium text-[20px] text-[var(--text-secondary)]'>
            Knowledge base not found
          </h2>
          <p className='text-[var(--text-muted)] text-small'>{source.unavailableCopy('missing')}</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <Resource.Options
        search={{
          value: search,
          onChange: onSearchChange,
          placeholder: 'Search documents...',
        }}
        sort={sortConfig}
        filter={{ content: filterContent }}
        filterTags={filterTags}
        aside={connectorBadges}
      />
      <Resource.Table
        columns={DOCUMENT_COLUMNS}
        rows={documentRows}
        selectable={selectableConfig}
        onRowClick={interaction?.onRowClick}
        onRowContextMenu={interaction?.onRowContextMenu}
        pagination={pagination}
        overlay={interaction?.overlay}
      />
    </>
  )
}
