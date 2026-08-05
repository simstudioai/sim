/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EXPORT_PRESERVED_RESOURCE_TYPES,
  sanitizeForExport,
} from '@/lib/workflows/credentials/credential-extractor'
import { WORKFLOW_SEARCH_SUBBLOCK_RESOURCE_TYPES } from '@/lib/workflows/search-replace/resources/registry'
import { getBlock } from '@/blocks/registry'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

function stateWithSubBlock(type: string, value: unknown): Partial<WorkflowState> {
  return {
    blocks: {
      b1: {
        id: 'b1',
        type: 'test-block',
        name: 'Test',
        position: { x: 0, y: 0 },
        subBlocks: { field: { id: 'field', type, value } },
        outputs: {},
        enabled: true,
      },
    },
  } as unknown as Partial<WorkflowState>
}

function sanitizedValue(type: string, value: unknown): unknown {
  vi.mocked(getBlock).mockReturnValue({
    name: 'Test',
    description: '',
    subBlocks: [{ id: 'field', title: 'Field', type }],
    outputs: {},
  } as never)
  const sanitized = sanitizeForExport(stateWithSubBlock(type, value))
  return sanitized.blocks?.b1?.subBlocks?.field?.value
}

describe('export sanitizer resource coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * The drift guard. Adding a selector to the resource registry without deciding how export
   * should treat it fails here rather than silently shipping a workspace-scoped id to another
   * workspace — which is exactly how raw `tbl_…` table ids used to escape.
   */
  it.each(
    WORKFLOW_SEARCH_SUBBLOCK_RESOURCE_TYPES.filter(
      (type) => !EXPORT_PRESERVED_RESOURCE_TYPES.has(type)
    )
  )('clears %s on export', (type) => {
    expect(sanitizedValue(type, 'res-id-123')).toBeNull()
  })

  it('clears a table-selector id, the omission that leaked ids across workspaces', () => {
    expect(sanitizedValue('table-selector', 'tbl_239e870374c14d4a89923175a7b10648')).toBeNull()
  })

  /**
   * Nothing on the import path remaps workflow references — `import-export.ts` extracts each
   * workflow independently under a fresh id — so a preserved reference names a workflow that does
   * not exist in the target, bundle or not.
   */
  it('clears workflow-selector, since import never remaps the id it names', () => {
    expect(sanitizedValue('workflow-selector', 'wf-123')).toBeNull()
  })

  it('still clears oauth-input, via the credential rule rather than the workspace rule', () => {
    expect(sanitizedValue('oauth-input', 'cred-123')).toBeNull()
  })

  it('leaves an ordinary field untouched', () => {
    expect(sanitizedValue('short-input', 'plain text')).toBe('plain text')
  })

  it('clears tableId by key on a block with no registry config', () => {
    vi.mocked(getBlock).mockReturnValue(undefined as never)
    const sanitized = sanitizeForExport({
      blocks: {
        b1: {
          id: 'b1',
          type: 'unknown-block',
          name: 'Test',
          position: { x: 0, y: 0 },
          subBlocks: { tableId: { id: 'tableId', type: 'short-input', value: 'tbl_abc' } },
          outputs: {},
          enabled: true,
        },
      },
    } as unknown as Partial<WorkflowState>)
    expect(sanitized.blocks?.b1?.subBlocks?.tableId?.value).toBeNull()
  })
})
