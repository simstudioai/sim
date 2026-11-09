'use client'

import { useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Icon } from '@sim/emcn/icon'
import { SearchField } from '@sim/emcn/search-field'
import { InlineNotice } from '@sim/emcn/status'
import { enrichmentMark } from '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/column-types/enrichment-marks'
import { EnrichmentConfig } from '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/enrichments-panel/enrichment-config'
import styles from '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/enrichments-panel/enrichments-panel.module.css'
import {
  SidePanel,
  SidePanelNote,
} from '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/side-panel/side-panel'
import {
  ALL_ENRICHMENTS,
  type ColumnDefinition,
  type EnrichmentConfig as EnrichmentDefinition,
  getEnrichment,
  type WorkflowGroup,
} from '@/platform/lib/data/tables'

function EnrichmentMark({ id }: { id: string }) {
  const glyph = enrichmentMark(id)
  return typeof glyph === 'string' ? <Icon name={glyph} /> : <Icon providerId={glyph.providerId} />
}

interface EnrichmentsPanelProps {
  onClose: () => void
  allColumns: ColumnDefinition[]
  workspaceId: string
  tableId: string
  /** Opens this enrichment group's settings directly, to edit it, instead of the catalog. */
  editGroup?: WorkflowGroup
}

/**
 * The table's enrichments: the code-defined catalog, searchable by name and description. Picking
 * one swaps its settings into the same panel, with a way back; saving adds an enrichment column.
 */
export function EnrichmentsPanel({
  onClose,
  allColumns,
  workspaceId,
  tableId,
  editGroup,
}: EnrichmentsPanelProps) {
  const [selected, setSelected] = useState<EnrichmentDefinition | null>(null)
  const [query, setQuery] = useState('')

  if (editGroup) {
    const enrichment = getEnrichment(editGroup.enrichmentId)
    // A group whose enrichment left the registry says so rather than offering the catalog.
    if (!enrichment) {
      return (
        <SidePanel title='Enrichment' onClose={onClose}>
          <InlineNotice
            intent='warning'
            message={`This enrichment ("${editGroup.enrichmentId ?? ''}") is no longer available. Delete the column and add a current enrichment.`}
          />
        </SidePanel>
      )
    }
    return (
      <EnrichmentConfig
        key={editGroup.id}
        enrichment={enrichment}
        existingGroup={editGroup}
        allColumns={allColumns}
        workspaceId={workspaceId}
        tableId={tableId}
        onClose={onClose}
      />
    )
  }

  if (selected) {
    return (
      <EnrichmentConfig
        key={selected.id}
        enrichment={selected}
        allColumns={allColumns}
        workspaceId={workspaceId}
        tableId={tableId}
        onBack={() => setSelected(null)}
        onClose={onClose}
      />
    )
  }

  const normalized = query.trim().toLowerCase()
  const enrichments = normalized
    ? ALL_ENRICHMENTS.filter(
        (enrichment) =>
          enrichment.name.toLowerCase().includes(normalized) ||
          enrichment.description.toLowerCase().includes(normalized)
      )
    : ALL_ENRICHMENTS

  return (
    <SidePanel title='Enrichments' onClose={onClose}>
      <SearchField
        label='Search enrichments'
        placeholder='Search'
        value={query}
        onValueChange={setQuery}
      />
      {enrichments.length === 0 ? (
        <SidePanelNote>No enrichments found.</SidePanelNote>
      ) : (
        <ul className={styles.catalog} aria-label='Enrichments'>
          {enrichments.map((enrichment) => (
            <ActivityRow
              key={enrichment.id}
              leading={<EnrichmentMark id={enrichment.id} />}
              title={enrichment.name}
              detail={enrichment.description}
              wrapDetail
              onOpen={() => setSelected(enrichment)}
            />
          ))}
        </ul>
      )}
    </SidePanel>
  )
}
