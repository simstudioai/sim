/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
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

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))

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
  ChipSelect: ({
    options,
    value,
    placeholder,
  }: {
    options: Array<{ value: string; label: string }>
    value?: string
    placeholder?: string
  }) => (
    <div data-combobox={placeholder} data-value={value}>
      {options.map((option) => (
        <span key={option.value}>{option.label}</span>
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

vi.mock('@sim/emcn/icons', () => ({
  ChevronDown: () => null,
  ChevronUp: () => null,
  Plus: () => null,
  Trash: () => null,
}))

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

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  seedDeploymentShape({ ...resolveDeploymentShape(), hosted: true })
})

afterEach(() => {
  resetDeploymentShape()
  vi.unstubAllGlobals()
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

  it('renders only the add affordance when nothing is configured', () => {
    const html = render()
    expect(html).toContain('Add fallback model')
    expect(html).not.toContain('choice')
  })

  it('labels rows as ordinal choices and offers viable, permitted models', () => {
    subBlockValues.fallbackModels = [
      { id: 'r1', model: 'gpt-5' },
      { id: 'r2', model: '' },
    ]
    const html = render()
    expect(html).toContain('2nd choice')
    expect(html).toContain('3rd choice')
    expect(html).not.toContain('Auto')
    expect(html).not.toContain('denied-model')
    /** The primary is never offered. A model another row holds is disabled there, never in its own row. */
    expect(html).not.toContain('>claude-sonnet-5<')
    expect(html.match(/data-disabled="true">gpt-5</g)).toHaveLength(1)
    expect(html.match(/>gpt-5</g)).toHaveLength(2)
    expect(html).toContain('aria-label="Move up"')
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

  it('asks for an environment variable only when the row model needs its own key', () => {
    subBlockValues.fallbackModels = [{ id: 'r1', model: 'gpt-5' }]
    expect(render()).not.toContain('data-combobox="Select a secret"')

    subBlockValues.fallbackModels = [
      { id: 'r1', model: 'openrouter/x', apiKey: '{{OPENROUTER_API_KEY}}' },
    ]
    const html = render()
    expect(html).toContain('data-combobox="Select a secret"')
    expect(html).toContain('data-value="{{OPENROUTER_API_KEY}}"')
    expect(html).toContain('OPENROUTER_API_KEY')
    expect(html).toContain('Create Secret')
  })

  it('updates key visibility when hosted context arrives after mount, without rewriting the rows', async () => {
    seedDeploymentShape({ ...resolveDeploymentShape(), hosted: false })
    subBlockValues.fallbackModels = [{ id: 'r1', model: 'gpt-5' }]
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(<ModelFallbackList blockId='block-1' subBlockId='fallbackModels' />)
      })
      expect(container.querySelector('[data-combobox="Select a secret"]')).not.toBeNull()

      await act(async () => {
        seedDeploymentShape({ ...resolveDeploymentShape(), hosted: true })
      })
      expect(container.querySelector('[data-combobox="Select a secret"]')).toBeNull()
      expect(mockSetValue).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
    }
  })

  it('shows a tuning field only for the knobs the helper says need one', () => {
    subBlockValues.fallbackModels = [
      { id: 'r1', model: 'gpt-5', reasoningEffort: 'low' },
      { id: 'r2', model: 'openrouter/x' },
    ]
    const html = render()
    expect(html).toContain('data-combobox="Select reasoning effort" data-value="low"')
    expect(html.match(/Select reasoning effort/g)).toHaveLength(1)
    expect(html).not.toContain('Thinking level')
  })

  it('gates a preview against the previewed primary, not the live block', () => {
    /** The live block selects claude-sonnet-5; the previewed version selected gpt-5. */
    const html = render({
      isPreview: true,
      previewValue: [{ id: 'r1', model: 'openrouter/x' }],
      previewPrimary: { model: 'gpt-5' },
    })
    expect(html).not.toContain('>gpt-5<')
    expect(html).toContain('>claude-sonnet-5<')
    expect(html).not.toContain('Add fallback model')
  })

  it('disables the add affordance at the cap', () => {
    subBlockValues.fallbackModels = Array.from({ length: 5 }, (_, i) => ({
      id: `r${i}`,
      model: `m-${i}`,
    }))
    const html = render()
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Add fallback model/)
  })
})
