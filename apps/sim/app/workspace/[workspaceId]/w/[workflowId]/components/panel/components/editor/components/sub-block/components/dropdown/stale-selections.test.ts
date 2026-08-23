/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { staleSelectionOptions } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/dropdown/stale-selections'

const loaded = new Set(['col_a', 'col_b'])

describe('staleSelectionOptions', () => {
  it('gives a selected value the list no longer contains its own removable row, labelled by id', () => {
    expect(
      staleSelectionOptions({
        selected: ['col_a', 'col_gone'],
        optionIds: loaded,
        listLoaded: true,
      })
    ).toEqual([{ id: 'col_gone', label: 'col_gone' }])
  })

  it('reports nothing while the list is not authoritative', () => {
    expect(
      staleSelectionOptions({ selected: ['col_gone'], optionIds: new Set(), listLoaded: false })
    ).toEqual([])
  })

  it('never treats a run-time expression, blank, or duplicate as stale', () => {
    expect(
      staleSelectionOptions({
        selected: ['<start.column>', '{{COLUMN}}', '', 'col_gone', 'col_gone'],
        optionIds: loaded,
        listLoaded: true,
      })
    ).toEqual([{ id: 'col_gone', label: 'col_gone' }])
  })
})
