/**
 * @vitest-environment node
 *
 * The security property of `resolveCellRender`: the `sim-resource` cell kind —
 * the only kind whose renderer mounts workspace-authenticated queries — is
 * unreachable without a `currentWorkspaceId`. A share-scope consumer passes
 * `undefined` and gets a plain favicon link instead.
 *
 * `SimResourceCell` mounts `useWorkflows`, `useTablesList`, `useKnowledgeBasesQuery`
 * and `useWorkspaceFiles`, so emitting this kind on a public surface would fire
 * cookie-authenticated `/api/…` reads from an anonymous viewer. The guard lives in
 * `resolveSimResourceKind`; these tests are what keep it there.
 */
import { describe, expect, it } from 'vitest'
import type { DisplayColumn } from '@/components/resources/table-view'
import { resolveCellRender } from '@/components/resources/table-view'
import type { RowExecutionMetadata } from '@/lib/table'

const WORKSPACE_ID = 'ws_00000000'

function column(overrides: Partial<DisplayColumn> = {}): DisplayColumn {
  return {
    id: 'col_link',
    name: 'link',
    type: 'string',
    key: 'col_link',
    groupSize: 1,
    groupStartColIndex: 0,
    headerLabel: 'link',
    isGroupStart: true,
    ...overrides,
  } as DisplayColumn
}

/** A workflow-output column — the second code path that promotes a value to a link. */
const workflowColumn = column({ workflowGroupId: 'grp_1', type: 'json', outputBlockId: 'blk_1' })

const completedExec = { status: 'completed' } as RowExecutionMetadata

/**
 * Every URL shape that addresses a sim resource in the current workspace, in
 * both the absolute and relative spellings the resolver accepts. Each entry is
 * asserted to be a *real* `sim-resource` URL (with a workspace id) before being
 * asserted not to produce that kind without one — so the negative assertions
 * can never pass vacuously against a URL the resolver simply doesn't recognise.
 */
const IN_WORKSPACE_URLS = [
  `https://sim.ai/workspace/${WORKSPACE_ID}/w/wf_1`,
  `https://sim.ai/workspace/${WORKSPACE_ID}/tables/tbl_1`,
  `https://sim.ai/workspace/${WORKSPACE_ID}/knowledge/kb_1`,
  `https://sim.ai/workspace/${WORKSPACE_ID}/files/file_1`,
  `/workspace/${WORKSPACE_ID}/w/wf_1`,
  `/workspace/${WORKSPACE_ID}/tables/tbl_1`,
  `/workspace/${WORKSPACE_ID}/knowledge/kb_1`,
  `/workspace/${WORKSPACE_ID}/files/file_1`,
  `/workspace/${WORKSPACE_ID}/files/file_1?download=1`,
  `https://sim.ai/workspace/${WORKSPACE_ID}/w/wf_1/`,
]

/** Both call sites that can promote a cell value to a link. */
const CELL_PATHS = [
  { label: 'string column', column: column(), exec: undefined },
  { label: 'workflow-output column', column: workflowColumn, exec: completedExec },
] as const

describe('resolveCellRender — sim-resource requires a workspace id', () => {
  it.each(IN_WORKSPACE_URLS)('emits sim-resource for %s when the workspace id matches', (url) => {
    for (const path of CELL_PATHS) {
      const kind = resolveCellRender({
        value: url,
        exec: path.exec,
        column: path.column,
        waitingOnLabels: undefined,
        currentWorkspaceId: WORKSPACE_ID,
      })
      expect(kind.kind, `${path.label}: ${url}`).toBe('sim-resource')
    }
  })

  it.each(IN_WORKSPACE_URLS)('never emits sim-resource for %s without a workspace id', (url) => {
    for (const path of CELL_PATHS) {
      const kind = resolveCellRender({
        value: url,
        exec: path.exec,
        column: path.column,
        waitingOnLabels: undefined,
        currentWorkspaceId: undefined,
      })
      expect(kind.kind, `${path.label}: ${url}`).not.toBe('sim-resource')
    }
  })

  it('falls through to a plain external link, not a resource chip', () => {
    const kind = resolveCellRender({
      value: `https://sim.ai/workspace/${WORKSPACE_ID}/tables/tbl_1`,
      exec: undefined,
      column: column(),
      waitingOnLabels: undefined,
      currentWorkspaceId: undefined,
    })
    expect(kind).toEqual({
      kind: 'url',
      text: `https://sim.ai/workspace/${WORKSPACE_ID}/tables/tbl_1`,
      href: `https://sim.ai/workspace/${WORKSPACE_ID}/tables/tbl_1`,
      domain: 'sim.ai',
    })
  })

  it('does not emit sim-resource for a URL in a different workspace', () => {
    const kind = resolveCellRender({
      value: '/workspace/ws_other/tables/tbl_1',
      exec: undefined,
      column: column(),
      waitingOnLabels: undefined,
      currentWorkspaceId: WORKSPACE_ID,
    })
    expect(kind.kind).not.toBe('sim-resource')
  })

  it('emits no sim-resource kind for any cell shape when the workspace id is absent', () => {
    const values: unknown[] = [
      ...IN_WORKSPACE_URLS,
      null,
      undefined,
      '',
      'plain text',
      'example.com',
      'https://example.com/path',
      42,
      true,
      { href: `/workspace/${WORKSPACE_ID}/w/wf_1` },
      [`/workspace/${WORKSPACE_ID}/w/wf_1`],
    ]
    const columns: DisplayColumn[] = [
      column({ type: 'string' }),
      column({ type: 'number' }),
      column({ type: 'boolean' }),
      column({ type: 'date' }),
      column({ type: 'json' }),
      column({ type: 'currency', currencyCode: 'USD' }),
      column({ type: 'select', options: [{ id: 'opt_a', name: 'A' }] }),
      workflowColumn,
    ]
    const execs: Array<RowExecutionMetadata | undefined> = [undefined, completedExec]

    for (const value of values) {
      for (const col of columns) {
        for (const exec of execs) {
          const kind = resolveCellRender({
            value,
            exec,
            column: col,
            waitingOnLabels: undefined,
            currentWorkspaceId: undefined,
          })
          expect(kind.kind, `${col.type} / ${String(value)}`).not.toBe('sim-resource')
        }
      }
    }
  })
})
