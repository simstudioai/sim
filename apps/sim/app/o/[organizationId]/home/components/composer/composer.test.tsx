/** @vitest-environment jsdom */
import { act, type ComponentProps, useEffect, useState } from 'react'
import { ToastProvider } from '@sim/emcn'
import {
  createMockDeploymentShape,
  deploymentShapeMock,
  deploymentShapeMockFns,
} from '@sim/testing/mocks/deployment-shape.mock'
import { integrationMatcherMock } from '@sim/testing/mocks/integration-matcher.mock'
import {
  organizationProviderMock,
  organizationProviderMockFns,
} from '@sim/testing/mocks/organization-provider.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { useSpeechToText } from '@/hooks/use-speech-to-text'
import { useMothershipEffortStore } from '@/stores/mothership-effort/store'

const mocks = vi.hoisted(() => ({
  plan: false,
  advanced: false,
  speech: vi.fn<typeof useSpeechToText>(),
  toggleListening: vi.fn(),
  resetTranscript: vi.fn(),
  submit: vi.fn(),
  contexts: vi.fn(),
  upload: vi.fn(),
  skillQuery: vi.fn(),
  resourceMenu: vi.fn(),
  openResourceMenu: vi.fn(),
  workspaces: [
    {
      id: 'workspace-a',
      name: 'Team',
      organizationId: 'organization-a',
      workspaceMode: 'grandfathered_shared',
    },
    {
      id: 'workspace-other',
      name: 'Other org',
      organizationId: 'organization-b',
      workspaceMode: 'organization',
    },
  ],
}))

vi.mock('@/lib/core/config/deployment-shape', () => deploymentShapeMock)
vi.mock('@/hooks/queries/workspace', () => ({
  useWorkspacesQuery: () => ({ data: mocks.workspaces }),
}))
vi.mock('@/hooks/queries/skills', () => ({
  useSkills: () => ({ data: [] }),
  getSkillsQueryOptions: (workspaceId: string) => ({
    queryKey: ['composer-test-skills', workspaceId],
    queryFn: () => mocks.skillQuery(workspaceId),
    staleTime: Number.POSITIVE_INFINITY,
  }),
}))
vi.mock('@/hooks/queries/mcp', () => ({ useMcpToolServers: () => ({ data: [] }) }))
vi.mock('@/blocks/integration-matcher', () => integrationMatcherMock)
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/user-input/components/plus-menu-dropdown/plus-menu-dropdown',
  async () => {
    const { forwardRef, useImperativeHandle } = await import('react')
    return {
      PlusMenuDropdown: forwardRef((props, ref) => {
        mocks.resourceMenu(props)
        useImperativeHandle(ref, () => ({
          open: mocks.openResourceMenu,
          close: vi.fn(),
          moveActive: vi.fn(),
          selectActive: () => 'empty',
        }))
        return null
      }),
    }
  }
)

vi.mock('@/hooks/use-speech-to-text', () => ({ useSpeechToText: mocks.speech }))
vi.mock('@/lib/uploads/client/session-upload', () => ({ uploadInternalFileSession: mocks.upload }))
vi.mock('@/hooks/use-animated-placeholder', () => ({ useAnimatedPlaceholder: () => 'Ask Sim to' }))
vi.mock('@/hooks/use-chat-input-focus', () => ({ useChatInputFocus: vi.fn() }))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => organizationProviderMock)

import { Composer } from '@/app/o/[organizationId]/home/components/composer/composer'
import type { ChatRequestMode } from '@/app/workspace/[workspaceId]/home/types'
import { FeatureFlagsProvider } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { useFileAttachments } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'

const deploymentShape = () => createMockDeploymentShape()
deploymentShapeMockFns.mockUseDeploymentShape.mockImplementation(deploymentShape)
deploymentShapeMockFns.mockGetDeploymentShape.mockImplementation(deploymentShape)
organizationProviderMockFns.mockUseOrganizationContext.mockReturnValue({
  organization: { id: 'organization-a' },
})

let root: Root
let container: HTMLDivElement
let queryClient: QueryClient

beforeEach(() => {
  mocks.advanced = false
  useMothershipEffortStore.setState({
    effort: 'high',
    modelSelection: { model: 'gpt-6-astra', fastMode: false },
  })
  mocks.plan = false
  vi.clearAllMocks()
  mocks.workspaces = [
    {
      id: 'workspace-a',
      name: 'Team',
      organizationId: 'organization-a',
      workspaceMode: 'grandfathered_shared',
    },
    {
      id: 'workspace-other',
      name: 'Other org',
      organizationId: 'organization-b',
      workspaceMode: 'organization',
    },
  ]
  mocks.skillQuery.mockResolvedValue([
    {
      id: 'skill-a',
      workspaceId: 'workspace-a',
      userId: 'user-a',
      name: 'review',
      description: 'Review a draft',
      content: 'Review carefully.',
      canEdit: true,
      createdAt: '',
      updatedAt: '',
    },
  ])
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    'DataTransfer',
    class {
      files: File[] = []
      items = { add: (file: File) => this.files.push(file) }
    }
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  )
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:image-preview')
      static revokeObjectURL = vi.fn()
    }
  )
  mocks.upload.mockResolvedValue({
    key: 'assistant/organization-a/user-a/image-a/screenshot.png',
    path: '/api/files/serve/image-a?context=mothership',
  })
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
  mocks.speech.mockReturnValue({
    isSupported: true,
    isListening: false,
    audioLevels: new Float32Array(5),
    toggleListening: mocks.toggleListening,
    resetTranscript: mocks.resetTranscript,
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  vi.useRealTimers()
  container.remove()
  queryClient.clear()
})

async function render(
  isInitialView: boolean,
  initialValue = 'Summarize',
  requestMode: 'agent' | 'assistant' = 'assistant',
  controls: Pick<
    ComponentProps<typeof Composer>,
    'isSending' | 'showModeSelector' | 'onModeChange' | 'restoredContexts' | 'onSendQueuedHead'
  > = { isSending: false }
) {
  function Harness() {
    const [value, setValue] = useState(initialValue)
    const files = useFileAttachments({
      userId: 'user-a',
      organizationId: 'organization-a',
      requestMode,
    })
    return (
      <Composer
        requestMode={requestMode}
        showModeSelector={controls.showModeSelector}
        onModeChange={controls.onModeChange}
        restoredContexts={controls.restoredContexts}
        value={value}
        files={files}
        onChange={setValue}
        isInitialView={isInitialView}
        isSending={controls.isSending}
        onStop={vi.fn()}
        onSendQueuedHead={controls.onSendQueuedHead}
        onSubmit={(text, contexts) => {
          mocks.submit(text, files.attachedFiles)
          mocks.contexts(contexts)
          setValue('')
          files.clearAttachedFiles()
        }}
      />
    )
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <FeatureFlagsProvider
          flags={{
            dashboards: false,
            'table-row-ttl': false,
            'mothership-model-selector': mocks.advanced,
            'mothership-plan-mode': mocks.plan,
          }}
        >
          <Harness />
        </FeatureFlagsProvider>
      </QueryClientProvider>
    )
  )
}

function fileList(files: File[]): FileList {
  return Object.assign(files, { item: (index: number) => files[index] ?? null })
}

it.each([
  { searchEnabled: true, planEnabled: true, modes: ['assistant', 'agent', 'plan', 'assistant'] },
  { searchEnabled: true, planEnabled: false, modes: ['assistant', 'agent', 'assistant'] },
  { searchEnabled: false, planEnabled: true, modes: ['agent', 'plan', 'agent'] },
  { searchEnabled: true, planEnabled: true, withDocument: true, modes: ['agent', 'plan', 'agent'] },
] satisfies {
  searchEnabled: boolean
  planEnabled: boolean
  withDocument?: boolean
  modes: ChatRequestMode[]
}[])(
  'cycles available modes without losing the draft or selection (Search: $searchEnabled, Plan: $planEnabled, document: $withDocument)',
  async ({ searchEnabled, planEnabled, modes, withDocument = false }) => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
    let currentMode = modes[0]
    function Harness() {
      const [mode, setMode] = useState(modes[0])
      currentMode = mode
      const [value, setValue] = useState('Summarize this draft')
      const files = useFileAttachments({
        userId: 'user-a',
        organizationId: 'organization-a',
        requestMode: mode,
      })
      const { restoreAttachedFiles } = files
      useEffect(() => {
        if (withDocument) {
          restoreAttachedFiles([
            {
              id: 'document-a',
              name: 'Draft.pdf',
              type: 'application/pdf',
              size: 1024,
              key: 'sample/draft.pdf',
              path: '',
              uploading: false,
            },
          ])
        }
      }, [restoreAttachedFiles])
      return (
        <Composer
          requestMode={mode}
          searchEnabled={searchEnabled}
          showModeSelector
          onModeChange={setMode}
          value={value}
          onChange={setValue}
          files={files}
          isInitialView
          isSending={false}
          onStop={() => {}}
          onSubmit={() => {}}
        />
      )
    }
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <FeatureFlagsProvider
            flags={{
              dashboards: false,
              'table-row-ttl': false,
              'mothership-model-selector': false,
              'mothership-plan-mode': planEnabled,
            }}
          >
            <Harness />
            <ToastProvider />
          </FeatureFlagsProvider>
        </QueryClientProvider>
      )
    )
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="Ask Sim"]')!
    await act(async () => {
      input.focus()
      input.setSelectionRange(10, 14, 'backward')
    })
    for (const expectedMode of modes.slice(1)) {
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
      await act(async () => {
        container.querySelector<HTMLTextAreaElement>('[aria-label="Ask Sim"]')!.dispatchEvent(event)
      })
      await act(async () => vi.advanceTimersToNextFrame())
      const nextInput = container.querySelector<HTMLTextAreaElement>('[aria-label="Ask Sim"]')!
      expect(currentMode).toBe(expectedMode)
      expect(event.defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(nextInput)
      expect(nextInput.value).toBe('Summarize this draft')
      expect([
        nextInput.selectionStart,
        nextInput.selectionEnd,
        nextInput.selectionDirection,
      ]).toEqual([10, 14, 'backward'])
    }
  }
)

async function paste(files: File[]) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files: fileList(files),
      items: files.map((file) => ({ kind: 'file', getAsFile: () => file })),
      getData: () => '',
      types: [],
    },
  })
  await act(async () =>
    container
      .querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="Ask Sim"]')!
      .dispatchEvent(event)
  )
  return event
}

it('keeps restored queued skills scoped when replacing a draft', async () => {
  let restore: () => void = () => {}
  function Harness() {
    const [value, setValue] = useState('Original draft')
    const [contexts, setContexts] = useState<ComponentProps<typeof Composer>['restoredContexts']>()
    restore = () => {
      setValue('/review fix this')
      setContexts([
        { kind: 'skill', skillId: 'skill-a', label: 'review', workspaceId: 'workspace-a' },
      ])
    }
    const files = useFileAttachments({
      userId: 'user-a',
      organizationId: 'organization-a',
      requestMode: 'agent',
    })
    return (
      <Composer
        requestMode='agent'
        value={value}
        onChange={setValue}
        restoredContexts={contexts}
        files={files}
        isInitialView={false}
        isSending={false}
        onStop={() => {}}
        onSubmit={mocks.submit}
      />
    )
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <FeatureFlagsProvider
          flags={{
            dashboards: false,
            'table-row-ttl': false,
            'mothership-model-selector': mocks.advanced,
            'mothership-plan-mode': mocks.plan,
          }}
        >
          <Harness />
        </FeatureFlagsProvider>
      </QueryClientProvider>
    )
  )
  await act(async () => restore())
  expect(
    container.querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="Ask Sim"]')!.value
  ).toBe('\u2003review fix this')
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click()
  )
  expect(mocks.submit).toHaveBeenLastCalledWith('/review fix this', [
    { kind: 'skill', skillId: 'skill-a', label: 'review', workspaceId: 'workspace-a' },
  ])
})

it('shows global built-ins once with no workspace label and submits no invented workspace', async () => {
  mocks.workspaces = []
  await render(true, '', 'agent')
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Skills"]')!.click()
  )
  const rows = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
  const research = rows.filter((row) => row.textContent === 'research')
  expect(research).toHaveLength(1)
  expect(rows).toHaveLength(4)
  expect(mocks.skillQuery).not.toHaveBeenCalled()
  await act(async () => research[0].click())
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click()
  )
  expect(mocks.contexts).toHaveBeenLastCalledWith([
    { kind: 'skill', skillId: 'builtin-research', label: 'research' },
  ])
})

it.each([
  ['agent', false],
  ['assistant', false],
  ['agent', true],
  ['assistant', true],
] as const)(
  'queues once then sends immediately on rapid double Enter (%s, attachment: %s)',
  async (mode, withAttachment) => {
    const sendHead = vi.fn()
    await render(false, withAttachment ? '' : 'Use the latest report', mode, {
      isSending: true,
      onSendQueuedHead: sendHead,
    })
    if (withAttachment) await paste([new File(['image'], 'follow-up.png', { type: 'image/png' })])
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="Ask Sim"]')!
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      expect(mocks.submit).toHaveBeenCalledTimes(1)
      expect(sendHead).not.toHaveBeenCalled()
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(mocks.submit).toHaveBeenCalledTimes(1)
    expect(sendHead).toHaveBeenCalledExactlyOnceWith()
    expect(input.value).toBe('')
  }
)
