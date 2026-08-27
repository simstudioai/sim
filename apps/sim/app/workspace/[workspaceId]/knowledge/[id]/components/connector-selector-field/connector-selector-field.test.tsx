/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorConfigField } from '@/connectors/types'
import type { SelectorDefinition, SelectorKey } from '@/hooks/selectors/types'

const { getSelectorDefinitionMock, useSelectorOptionsMock } = vi.hoisted(() => ({
  getSelectorDefinitionMock: vi.fn(),
  useSelectorOptionsMock: vi.fn(() => ({
    data: [],
    isLoading: false,
    isFetching: false,
    isFetchingMore: false,
    hasMore: false,
    truncated: false,
    error: null,
  })),
}))

vi.mock('@sim/emcn', () => ({ ChipCombobox: () => null }))
vi.mock('@sim/emcn/icons', () => ({ Loader: () => null }))
vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1', id: 'knowledge-1' }),
}))
vi.mock('@/hooks/selectors/registry', () => ({
  getSelectorDefinition: getSelectorDefinitionMock,
}))
vi.mock('@/hooks/selectors/use-selector-query', () => ({
  useSelectorOptions: useSelectorOptionsMock,
  useSelectorOptionDetail: () => ({ data: null }),
  useSelectorOptionDetails: () => [],
}))
vi.mock('@/hooks/use-debounce', () => ({ useDebounce: (value: string) => value }))

import { ConnectorSelectorField } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-selector-field/connector-selector-field'

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('ConnectorSelectorField cache scope', () => {
  it('changes only when a server-resolved selector dependency changes', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const definition = {
      key: 'jira.projects' as SelectorKey,
      serverResolvedContextFields: ['domain'],
      getQueryKey: () => ['selectors', 'jira.projects'],
      fetchList: async () => [],
    } as SelectorDefinition
    getSelectorDefinitionMock.mockReturnValue(definition)

    const domainField: ConnectorConfigField = {
      id: 'domain-field',
      title: 'Domain',
      type: 'short-input',
      canonicalParamId: 'domain',
      mode: 'basic',
    }
    const projectField = {
      id: 'project',
      title: 'Project',
      type: 'selector',
      selectorKey: definition.key,
      dependsOn: ['domain-field'],
    } satisfies ConnectorConfigField & { selectorKey: SelectorKey }
    const configFields = [domainField, projectField]
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    const render = (domain: string, unrelated: string) => {
      act(() =>
        root?.render(
          <ConnectorSelectorField
            field={projectField}
            value=''
            onChange={vi.fn()}
            credentialId='credential-1'
            sourceConfig={{ 'domain-field': domain, unrelated }}
            configFields={configFields}
            canonicalModes={{ domain: 'basic' }}
          />
        )
      )
      return useSelectorOptionsMock.mock.calls.at(-1)?.[1].context.selectorCacheScope
    }

    const initial = render('{{JIRA_DOMAIN}}', 'first')
    const afterUnrelatedEdit = render('{{JIRA_DOMAIN}}', 'second')
    const afterDependencyEdit = render('{{OTHER_DOMAIN}}', 'second')

    expect(initial).toEqual(expect.any(String))
    expect(afterUnrelatedEdit).toBe(initial)
    expect(afterDependencyEdit).not.toBe(initial)
  })
})
