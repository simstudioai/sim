/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { KEY, SECRET, searchTargetRef } = vi.hoisted(() => ({
  KEY: 'BROWSER_LOGIN',
  SECRET: 'hunter2-plaintext',
  searchTargetRef: { current: null as Record<string, unknown> | null },
}))

vi.mock('@sim/emcn', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  Button: ({ children }: { children?: React.ReactNode }) => (
    <button type='button'>{children}</button>
  ),
}))

vi.mock('@sim/emcn/icons', () => ({
  Trash: () => null,
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/env-var-dropdown',
  () => ({ EnvVarDropdown: () => null })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown',
  () => ({ TagDropdown: () => null })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input',
  () => ({
    useSubBlockInput: () => ({
      fieldHelpers: {
        getFieldState: () => ({
          showEnvVars: false,
          showTags: false,
          searchTerm: '',
          cursorPosition: 0,
          activeSourceBlockId: null,
        }),
        createFieldHandlers: () => ({
          onChange: () => {},
          onKeyDown: () => {},
          onDrop: () => {},
          onDragOver: () => {},
          onFocus: () => {},
        }),
        createTagSelectHandler: () => () => {},
        createEnvVarSelectHandler: () => () => {},
        hideFieldDropdowns: () => {},
      },
    }),
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value',
  () => ({
    useSubBlockValue: () => [[{ id: 'row-1', cells: { Key: KEY, Value: SECRET } }], () => {}],
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider',
  () => ({ useActiveSearchTarget: () => searchTargetRef.current })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes',
  () => ({ useAccessibleReferencePrefixes: () => undefined })
)

import { Table } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/table'

function render(password: boolean) {
  return renderToStaticMarkup(
    <Table
      blockId='block-1'
      subBlockId='variables'
      columns={['Key', 'Value']}
      password={password}
    />
  )
}

/** A live workflow-search hit on the value cell of the only row. */
const VALUE_CELL_SEARCH_TARGET = {
  blockId: 'block-1',
  subBlockId: 'variables',
  targetKind: 'subblock',
  valuePath: [0, 'cells', 'Value'],
  query: SECRET,
  rawValue: SECRET,
  range: { start: 0, end: SECRET.length },
}

describe('Table password masking', () => {
  beforeEach(() => {
    searchTargetRef.current = null
  })

  it('conceals value cells while leaving the key column legible', () => {
    const html = render(true)

    expect(html).not.toContain(SECRET)
    expect(html).toContain(KEY)
    expect(html).toContain('•')
  })

  it('renders plaintext cells when the sub-block is not a password field', () => {
    const html = render(false)

    expect(html).toContain(SECRET)
    expect(html).toContain(KEY)
    expect(html).not.toContain('•')
  })

  it('keeps a value cell concealed while workflow search targets it', () => {
    searchTargetRef.current = VALUE_CELL_SEARCH_TARGET

    const html = render(true)

    expect(html).not.toContain(SECRET)
    expect(html).toContain('•')
  })

  it('highlights a targeted value cell when the sub-block holds no secret', () => {
    searchTargetRef.current = VALUE_CELL_SEARCH_TARGET

    const html = render(false)

    expect(html).toContain('<mark')
    expect(html).toContain(SECRET)
  })
})
