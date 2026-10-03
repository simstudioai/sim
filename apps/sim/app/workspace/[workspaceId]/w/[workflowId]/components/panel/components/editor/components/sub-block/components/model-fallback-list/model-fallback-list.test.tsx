/**
 * @vitest-environment jsdom
 */

import { emcnIconsMock } from '@sim/testing/mocks/emcn-icons.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getDeploymentShape,
  resetDeploymentShape,
  resolveDeploymentShape,
  seedDeploymentShape,
} from '@/lib/core/config/deployment-shape'

const { subBlockValues, mockSetValue } = vi.hoisted(() => ({
  subBlockValues: {
    model: 'claude-sonnet-5' as string,
    fallbackModels: [] as Array<{
      id: string
      model: string
      apiKey?: string
      reasoningEffort?: string
    }>,
  },
  mockSetValue: vi.fn(),
}))

vi.mock('next/navigation', () => nextNavigationMock)

vi.mock('@sim/emcn', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Chip: ({
    children,
    disabled,
    'aria-label': ariaLabel,
  }: {
    children?: React.ReactNode
    disabled?: boolean
    'aria-label'?: string
  }) => (
    <button type='button' disabled={disabled} aria-label={ariaLabel}>
      {children}
    </button>
  ),
  Combobox: ({
    options,
    value,
    placeholder,
  }: {
    options: Array<{ value: string; label: string; disabled?: boolean }>
    value?: string
    placeholder?: string
  }) => (
    <div data-combobox={placeholder} data-value={value}>
      {options.map((option) => (
        <span key={option.value} data-disabled={option.disabled ? 'true' : undefined}>
          {option.label}
        </span>
      ))}
    </div>
  ),
  Label: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Tooltip: {
    Root: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Trigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Content: () => null,
  },
}))

vi.mock('@sim/emcn/icons', () => emcnIconsMock)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value',
  () => ({
    useSubBlockValue: (_blockId: string, subBlockId: string) => [
      subBlockId === 'model' || subBlockId === 'fallbackModels' ? subBlockValues[subBlockId] : null,
      mockSetValue,
    ],
  })
)

vi.mock('@/hooks/queries/environment', () => ({
  usePersonalEnvironment: () => ({ data: { PERSONAL_KEY: 'x' } }),
  useWorkspaceEnvironment: () => ({
    data: { workspace: { OPENROUTER_API_KEY: 'x' }, personal: {}, conflicts: [] },
  }),
}))

vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({ isModelUsable: (model: string) => model !== 'denied-model' }),
}))

vi.mock('@/hooks/use-settings-navigation', () => ({
  useSettingsNavigation: () => ({ navigateToSettings: vi.fn() }),
}))

vi.mock('@/lib/credentials/client-state', () => ({
  writePendingCredentialCreateRequest: vi.fn(),
}))

vi.mock('@/stores/providers/store', () => ({
  useProvidersStore: (selector: (state: { providers: object }) => unknown) =>
    selector({ providers: {} }),
}))

vi.mock('@/blocks/utils', () => ({
  shouldRequireApiKeyForModel: (model: string) =>
    model.startsWith('openrouter/') || (model.startsWith('gpt') && !getDeploymentShape().hosted),
  getModelOptions: () => [
    { id: 'claude-sonnet-5', label: 'claude-sonnet-5' },
    { id: 'gpt-5', label: 'gpt-5' },
    { id: 'denied-model', label: 'denied-model' },
    { id: 'openrouter/x', label: 'openrouter/x' },
    { id: 'sim-auto', label: 'Auto' },
  ],
}))

vi.mock('@/lib/workflows/blocks/fallback-models', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workflows/blocks/fallback-models')>()
  return {
    ...actual,
    isViableFallbackModel: (model: string, primary: string) =>
      model !== 'sim-auto' && model !== primary,
    getFallbackTuningKnobsToShow: (model: string) => (model === 'gpt-5' ? ['reasoningEffort'] : []),
    getTuningOptionsForModel: (model: string, knob: string) =>
      model === 'gpt-5' && knob === 'reasoningEffort' ? ['auto', 'low', 'high'] : null,
  }
})

import { ModelFallbackList } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/model-fallback-list/model-fallback-list'

nextNavigationMockFns.mockUseParams.mockReturnValue({ workspaceId: 'workspace-1' })

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  seedDeploymentShape({ ...resolveDeploymentShape(), hosted: true })
})

afterEach(() => {
  resetDeploymentShape()
})

function render(extra: Partial<React.ComponentProps<typeof ModelFallbackList>> = {}) {
  return renderToStaticMarkup(
    <ModelFallbackList blockId='block-1' subBlockId='fallbackModels' disabled={false} {...extra} />
  )
}

describe('ModelFallbackList', () => {
  beforeEach(() => {
    subBlockValues.model = 'claude-sonnet-5'
    subBlockValues.fallbackModels = []
    mockSetValue.mockReset()
  })

  it('renders no move controls for a single row and never shows a non-reference key', () => {
    subBlockValues.fallbackModels = [
      { id: 'r1', model: 'openrouter/x', apiKey: 'sk-raw-through-socket' },
    ]
    const html = render()
    expect(html).not.toContain('aria-label="Move up"')
    expect(html).not.toContain('sk-raw-through-socket')
    expect(html).toContain('data-combobox="Select a secret" data-value=""')
  })
})
