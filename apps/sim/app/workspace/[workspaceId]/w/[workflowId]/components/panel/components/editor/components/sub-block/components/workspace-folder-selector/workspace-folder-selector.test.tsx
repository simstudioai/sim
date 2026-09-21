/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { folderQuery } = vi.hoisted(() => ({
  folderQuery: {
    folders: [{ id: 'old-folder', name: 'Old', parentId: null, sortOrder: 0, path: '/Old' }],
    byPath: new Map(),
    isLoading: false,
    isPlaceholderData: false,
    error: null,
    refetch: vi.fn(),
  },
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))

vi.mock('@sim/emcn', () => ({
  ChipCombobox: ({
    options,
    disabled,
    isLoading,
  }: {
    options: Array<{ value: string; label: string }>
    disabled?: boolean
    isLoading?: boolean
  }) => (
    <div data-disabled={disabled} data-loading={isLoading}>
      {options.map((option) => (
        <span key={option.value}>{option.label}</span>
      ))}
    </div>
  ),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-resource-folders',
  () => ({ useResourceFolders: () => folderQuery })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value',
  () => ({ useSubBlockValue: () => ['', vi.fn()] })
)

import { WorkspaceFolderSelector } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workspace-folder-selector/workspace-folder-selector'

describe('WorkspaceFolderSelector query transitions', () => {
  beforeEach(() => {
    folderQuery.isLoading = false
    folderQuery.isPlaceholderData = false
  })

  it('does not expose folders retained from the previous query key', () => {
    folderQuery.isPlaceholderData = true

    const html = renderToStaticMarkup(
      <WorkspaceFolderSelector
        blockId='block-1'
        subBlock={{ id: 'folderPaths', title: 'Folder', type: 'workspace-folder-selector' }}
      />
    )

    expect(html).not.toContain('Old')
    expect(html).toContain('data-disabled="true"')
    expect(html).toContain('data-loading="true"')
  })
})
