/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { DOCUMENT_COLUMNS } from '@/app/workspace/[workspaceId]/knowledge/[id]/document-columns'

describe('DOCUMENT_COLUMNS', () => {
  it('keeps the status column at the default width immediately before tags', () => {
    const statusIndex = DOCUMENT_COLUMNS.findIndex((column) => column.id === 'status')

    expect(DOCUMENT_COLUMNS[statusIndex]).toEqual({ id: 'status', header: 'Status' })
    expect(DOCUMENT_COLUMNS[statusIndex + 1]?.id).toBe('tags')
  })
})
