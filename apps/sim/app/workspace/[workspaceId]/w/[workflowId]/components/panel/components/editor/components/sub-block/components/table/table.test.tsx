/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const { KEY, SECRET } = vi.hoisted(() => ({
  KEY: 'BROWSER_LOGIN',
  SECRET: 'hunter2-plaintext',
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
  () => ({ useActiveSearchTarget: () => null })
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

describe('Table password masking', () => {
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
})
