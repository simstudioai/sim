/** @vitest-environment jsdom */

import { act, type ComponentProps, useState } from 'react'
import { ToastProvider, toast } from '@sim/emcn'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
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
import { useComposerSubmission } from '@/hooks/use-composer-submission'
import type { useSpeechToText } from '@/hooks/use-speech-to-text'
import { useMothershipDraftsStore } from '@/stores/mothership-drafts/store'
import {
  useMothershipEffortStore,
  useMothershipPlanEffortStore,
} from '@/stores/mothership-effort/store'
import type { ChatContext } from '@/stores/panel'

const mocks = vi.hoisted(() => ({
  workspacesLoading: false,
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
  useWorkspacesQuery: () =>
    mocks.workspacesLoading ? { data: undefined, isPending: true } : { data: mocks.workspaces },
  fetchWorkspacesList: async () => {
    mocks.workspacesLoading = false
    return mocks.workspaces
  },
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

import { FeatureFlagsProvider } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { useFileAttachments } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import { PageComposer as Composer } from '@/platform/app/(shell)/_components/conversation/page-composer'

const DRAFT_KEY = 'composer-test-draft'
const DRAFT_KEYS = [DRAFT_KEY]
/** One identity, since a new list is how a host restores a prompt. */
const NO_RESTORED_CONTEXTS: ChatContext[] = []
const writeDraft = (text: string) =>
  useMothershipDraftsStore.getState().setDraft(DRAFT_KEY, { text })

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
  vi.spyOn(toast, 'error').mockReturnValue('')
  mocks.advanced = false
  mocks.workspacesLoading = false
  useMothershipEffortStore.getState().reset()
  useMothershipPlanEffortStore.getState().reset()
  useMothershipDraftsStore.setState({ drafts: {} })
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
  stubResizeObserver()
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
  requestMode: 'agent' | 'assistant' | 'plan' = 'assistant',
  controls: Pick<ComponentProps<typeof Composer>, 'isSending'> &
    Partial<Pick<ComponentProps<typeof Composer>, 'restoredContexts' | 'onSendQueuedHead'>> = {
    isSending: false,
  }
) {
  writeDraft(initialValue)
  function Harness() {
    const submission = useComposerSubmission({ mode: requestMode })
    const files = useFileAttachments({
      userId: 'user-a',
      organizationId: 'organization-a',
      requestMode,
      disabled: submission.pending,
    })
    return (
      <Composer
        requestMode={requestMode}
        submission={submission}
        restoredContexts={controls.restoredContexts ?? NO_RESTORED_CONTEXTS}
        draftKeys={DRAFT_KEYS}
        files={files}
        isInitialView={isInitialView}
        isSending={controls.isSending}
        onStop={vi.fn()}
        onSendQueuedHead={controls.onSendQueuedHead ?? vi.fn()}
        onEditQueuedTail={() => false}
        messages={[]}
        onSubmit={(text, contexts) => {
          mocks.submit(text, files.attachedFiles)
          mocks.contexts(contexts)
          useMothershipDraftsStore.getState().clearDraft(DRAFT_KEY)
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
            'workflow-tests': false,
            changelog: false,
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

it.each([false, true])(
  'keeps restored queued skills scoped and warns about lost context (%s)',
  async (invalidContext) => {
    let restore: () => void = () => {}
    writeDraft('Original draft')
    function Harness() {
      const [contexts, setContexts] =
        useState<ComponentProps<typeof Composer>['restoredContexts']>(NO_RESTORED_CONTEXTS)
      restore = () => {
        writeDraft('/review fix this @Browser')
        setContexts([
          { kind: 'skill', skillId: 'skill-a', label: 'review', workspaceId: 'workspace-a' },
          ...(invalidContext
            ? [
                {
                  kind: 'browser_tab' as const,
                  tabId: 'tab-a',
                  label: 'Browser',
                  selection: { text: 'Selected passage', title: 'x'.repeat(513) },
                },
              ]
            : []),
        ])
      }
      const submission = useComposerSubmission({ mode: 'agent' })
      const files = useFileAttachments({
        userId: 'user-a',
        organizationId: 'organization-a',
        requestMode: 'agent',
        disabled: submission.pending,
      })
      return (
        <Composer
          requestMode='agent'
          submission={submission}
          draftKeys={DRAFT_KEYS}
          restoredContexts={contexts}
          files={files}
          isInitialView={false}
          isSending={false}
          onStop={() => {}}
          onSendQueuedHead={() => {}}
          onEditQueuedTail={() => false}
          messages={[]}
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
              'workflow-tests': false,
              changelog: false,
              'mothership-model-selector': mocks.advanced,
              'mothership-plan-mode': mocks.plan,
            }}
          >
            <Harness />
            <ToastProvider />
          </FeatureFlagsProvider>
        </QueryClientProvider>
      )
    )
    await act(async () => restore())
    expect(
      container.querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="Ask Sim"]')!
        .value
    ).toBe('\u2003review fix this @Browser')
    if (invalidContext) expect(document.body.textContent).toContain('Reattach it before sending.')
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click()
    )
    expect(mocks.submit).toHaveBeenLastCalledWith('/review fix this @Browser', [
      { kind: 'skill', skillId: 'skill-a', label: 'review', workspaceId: 'workspace-a' },
    ])
  }
)

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

it('preserves mode-specific models and unsent effort across composer remounts', async () => {
  mocks.plan = true
  mocks.advanced = true
  await render(false, '', 'plan')
  expect(container.textContent).toContain('Opus 5.5')
  expect(container.textContent).toContain('Medium')
  await act(async () => {
    useMothershipPlanEffortStore.getState().setModel('gpt-6-sol')
    useMothershipEffortStore.getState().setNewChatEffort('xhigh')
  })
  expect(container.textContent).toContain('GPT-6.1 Sol')
  expect(container.textContent).toContain('Extra High')
  await render(false, '', 'agent')
  expect(container.textContent).toContain('GPT-6 Astra')
  expect(container.textContent).toContain('Extra High')
  await render(false, '', 'plan')
  expect(container.textContent).toContain('GPT-6.1 Sol')
  expect(container.textContent).toContain('Extra High')
})

/** Flushes until the lists have landed and the editor has seen them, however busy the runner is. */
async function settleQueries(until?: () => void) {
  await act(async () => {
    await vi.waitFor(() => {
      expect(queryClient.isFetching()).toBe(0)
      until?.()
    })
  })
}

function required<Element extends HTMLElement>(selector: string) {
  const element = container.querySelector<Element>(selector)
  if (!element) throw new Error(`Nothing matches ${selector}`)
  return element
}

function typeInto(input: HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(input, text)
  input.setSelectionRange(text.length, text.length)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

it('warms the lists when the viewer presses the field, and opening the + menu does too', async () => {
  await render(true, '', 'agent')
  await act(async () =>
    required<HTMLTextAreaElement>('[aria-label="Ask Sim"]').dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true })
    )
  )
  expect(mocks.skillQuery).toHaveBeenCalledExactlyOnceWith('workspace-a')
  expect(mocks.resourceMenu.mock.lastCall?.[0].warm).toBe(true)

  await act(async () => root.unmount())
  root = createRoot(container)
  queryClient.clear()
  await render(true, '', 'agent')
  expect(mocks.resourceMenu.mock.lastCall?.[0].warm).toBe(false)
  await act(async () => required<HTMLButtonElement>('button[aria-label="Add resources"]').click())
  expect(mocks.openResourceMenu).toHaveBeenCalledOnce()
  expect(mocks.resourceMenu.mock.lastCall?.[0].warm).toBe(true)
})

it('a slash reads the skills only, and the resource lists stay cold', async () => {
  await render(true, '', 'agent')
  await act(async () => typeInto(required<HTMLTextAreaElement>('[aria-label="Ask Sim"]'), '/'))
  expect(mocks.skillQuery).toHaveBeenCalledExactlyOnceWith('workspace-a')
  expect(mocks.resourceMenu.mock.lastCall?.[0].warm).toBe(false)
})

it('a draft carrying a skill still chips once its list arrives', async () => {
  await render(true, '/review this', 'agent')
  const input = required<HTMLTextAreaElement>('[aria-label="Ask Sim"]')
  expect(mocks.skillQuery).toHaveBeenCalledExactlyOnceWith('workspace-a')
  await settleQueries(() => expect(input.value).toBe(' review this'))
  await act(async () => required<HTMLButtonElement>('button[aria-label="Send"]').click())
  expect(mocks.contexts).toHaveBeenLastCalledWith([
    { kind: 'skill', skillId: 'skill-a', label: 'review', workspaceId: 'workspace-a' },
  ])
})

it('a skill typed to its boundary before the lists land chips when they do, caret in place', async () => {
  let resolveSkills: (skills: unknown[]) => void = () => {}
  mocks.skillQuery.mockReturnValue(
    new Promise((resolve) => {
      resolveSkills = resolve
    })
  )
  await render(true, '', 'agent')
  const input = required<HTMLTextAreaElement>('[aria-label="Ask Sim"]')
  await act(async () => typeInto(input, '/'))
  await act(async () => typeInto(input, '/review now'))
  expect(input.value).toBe('/review now')
  await act(async () => {
    input.setSelectionRange(9, 9)
    resolveSkills([
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
  })
  await settleQueries(() => expect(input.value).toBe(' review now'))
  expect(input.selectionStart).toBe(9)
})

it('holds a slash message sent before the skills land, then sends it with its skill', async () => {
  let resolveSkills: (skills: unknown[]) => void = () => {}
  mocks.skillQuery.mockReturnValue(
    new Promise((resolve) => {
      resolveSkills = resolve
    })
  )
  await render(true, '', 'agent')
  const input = required<HTMLTextAreaElement>('[aria-label="Ask Sim"]')
  await act(async () => typeInto(input, '/'))
  await act(async () => typeInto(input, '/review this'))
  const pressEnter = () =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await act(async () => pressEnter())
  expect(mocks.contexts).not.toHaveBeenCalled()
  expect(input.closest('[aria-busy="true"]')).not.toBeNull()
  await act(async () => {
    resolveSkills([
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
  })
  await settleQueries()
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(mocks.contexts).toHaveBeenLastCalledWith([
      { kind: 'skill', skillId: 'skill-a', label: 'review', workspaceId: 'workspace-a' },
    ])
  })
  expect(input.closest('[aria-busy="true"]')).toBeNull()
})

it('a message with no slash goes out without waiting for any list', async () => {
  mocks.skillQuery.mockReturnValue(new Promise(() => {}))
  await render(true, '', 'agent')
  const input = required<HTMLTextAreaElement>('[aria-label="Ask Sim"]')
  await act(async () => typeInto(input, 'just a question'))
  await act(async () => required<HTMLButtonElement>('button[aria-label="Send"]').click())
  expect(mocks.contexts).toHaveBeenCalledTimes(1)
})

it('editing a held message cancels the hold', async () => {
  mocks.skillQuery.mockReturnValue(new Promise(() => {}))
  await render(true, '', 'agent')
  const input = required<HTMLTextAreaElement>('[aria-label="Ask Sim"]')
  await act(async () => typeInto(input, '/review this'))
  await act(async () => required<HTMLButtonElement>('button[aria-label="Send"]').click())
  expect(input.closest('[aria-busy="true"]')).not.toBeNull()
  await act(async () => typeInto(input, '/review this now'))
  expect(input.closest('[aria-busy="true"]')).toBeNull()
  expect(mocks.contexts).not.toHaveBeenCalled()
})

function holdThenExpire() {
  const expire = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(expire.signal)
  return expire
}

it('tells the viewer when the lists never land, keeps the message, and sends plain on the next try', async () => {
  const expire = holdThenExpire()
  mocks.skillQuery.mockReturnValue(new Promise(() => {}))
  await render(true, '', 'agent')
  const input = required<HTMLTextAreaElement>('[aria-label="Ask Sim"]')
  await act(async () => typeInto(input, '/review this'))
  await act(async () => required<HTMLButtonElement>('button[aria-label="Send"]').click())
  expect(input.closest('[aria-busy="true"]')).not.toBeNull()
  await act(async () => expire.abort())
  expect(mocks.submit).not.toHaveBeenCalled()
  expect(input.value).toBe('/review this')
  expect(input.closest('[aria-busy="true"]')).toBeNull()
  expect(toast.error).toHaveBeenCalledOnce()
  await act(async () => required<HTMLButtonElement>('button[aria-label="Send"]').click())
  expect(mocks.submit).toHaveBeenCalledOnce()
  expect(mocks.submit.mock.lastCall?.[0]).toBe('/review this')
})

it('a declined message edited and typed again waits and warns again', async () => {
  const firstExpiry = holdThenExpire()
  mocks.skillQuery.mockReturnValue(new Promise(() => {}))
  await render(true, '', 'agent')
  const input = required<HTMLTextAreaElement>('[aria-label="Ask Sim"]')
  const send = () => required<HTMLButtonElement>('button[aria-label="Send"]')
  await act(async () => typeInto(input, '/review this'))
  await act(async () => send().click())
  await act(async () => firstExpiry.abort())
  expect(toast.error).toHaveBeenCalledOnce()
  await act(async () => typeInto(input, '/review this now'))
  await act(async () => typeInto(input, '/review this'))
  const secondExpiry = holdThenExpire()
  await act(async () => send().click())
  expect(mocks.submit).not.toHaveBeenCalled()
  expect(input.closest('[aria-busy="true"]')).not.toBeNull()
  await act(async () => secondExpiry.abort())
  expect(toast.error).toHaveBeenCalledTimes(2)
  expect(mocks.submit).not.toHaveBeenCalled()
})

it('a list that fails while the send waits tells the viewer the same way', async () => {
  let failSkills: (error: Error) => void = () => {}
  mocks.skillQuery.mockReturnValue(
    new Promise((_resolve, reject) => {
      failSkills = reject
    })
  )
  await render(true, '', 'agent')
  const input = required<HTMLTextAreaElement>('[aria-label="Ask Sim"]')
  await act(async () => typeInto(input, '/review this'))
  await act(async () => required<HTMLButtonElement>('button[aria-label="Send"]').click())
  await act(async () => failSkills(new Error('down')))
  await settleQueries()
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(toast.error).toHaveBeenCalledOnce()
  })
  expect(mocks.submit).not.toHaveBeenCalled()
})

it('a path in a held message goes out as written once the lists land', async () => {
  let resolveSkills: (skills: unknown[]) => void = () => {}
  mocks.skillQuery.mockReturnValue(
    new Promise((resolve) => {
      resolveSkills = resolve
    })
  )
  await render(true, '', 'agent')
  const input = required<HTMLTextAreaElement>('[aria-label="Ask Sim"]')
  await act(async () => typeInto(input, 'read /etc/hosts'))
  await act(async () => required<HTMLButtonElement>('button[aria-label="Send"]').click())
  await act(async () => resolveSkills([]))
  await settleQueries()
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(mocks.submit).toHaveBeenCalledOnce()
  })
  expect(mocks.submit.mock.lastCall?.[0]).toBe('read /etc/hosts')
  expect(toast.error).not.toHaveBeenCalled()
})

it('editing away and back does not revive a cancelled hold', async () => {
  let resolveSkills: (skills: unknown[]) => void = () => {}
  mocks.skillQuery.mockReturnValue(
    new Promise((resolve) => {
      resolveSkills = resolve
    })
  )
  await render(true, '', 'agent')
  const input = required<HTMLTextAreaElement>('[aria-label="Ask Sim"]')
  await act(async () => typeInto(input, '/review this'))
  await act(async () => required<HTMLButtonElement>('button[aria-label="Send"]').click())
  await act(async () => typeInto(input, '/review this now'))
  await act(async () => typeInto(input, '/review this'))
  await act(async () => resolveSkills([]))
  await settleQueries()
  await act(async () => {})
  expect(mocks.submit).not.toHaveBeenCalled()
})

it('sends nothing once the composer has unmounted', async () => {
  let resolveSkills: (skills: unknown[]) => void = () => {}
  mocks.skillQuery.mockReturnValue(
    new Promise((resolve) => {
      resolveSkills = resolve
    })
  )
  await render(true, '', 'agent')
  const input = required<HTMLTextAreaElement>('[aria-label="Ask Sim"]')
  await act(async () => typeInto(input, '/review this'))
  await act(async () => required<HTMLButtonElement>('button[aria-label="Send"]').click())
  await act(async () => root.unmount())
  root = createRoot(container)
  await act(async () => resolveSkills([]))
  await act(async () => {})
  expect(mocks.submit).not.toHaveBeenCalled()
})

it('holds for the workspace list too, then chips against the skills it names', async () => {
  mocks.workspacesLoading = true
  await render(true, '', 'agent')
  const input = required<HTMLTextAreaElement>('[aria-label="Ask Sim"]')
  await act(async () => typeInto(input, '/review this'))
  await act(async () => required<HTMLButtonElement>('button[aria-label="Send"]').click())
  await settleQueries()
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(mocks.contexts).toHaveBeenLastCalledWith([
      { kind: 'skill', skillId: 'skill-a', label: 'review', workspaceId: 'workspace-a' },
    ])
  })
  expect(mocks.skillQuery).toHaveBeenCalledExactlyOnceWith('workspace-a')
})
