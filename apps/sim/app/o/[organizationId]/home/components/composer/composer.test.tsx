/** @vitest-environment jsdom */
import { act, type ComponentProps, useState } from 'react'
import { toast } from '@sim/emcn'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { useSpeechToText } from '@/hooks/use-speech-to-text'
import { useMothershipEffortStore } from '@/stores/mothership-effort/store'

const mocks = vi.hoisted(() => ({
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
vi.mock('@/blocks/integration-matcher', () => ({
  getIntegrationMatcher: () => ({ regex: null, byName: new Map() }),
}))
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
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: () => ({ organization: { id: 'organization-a' } }),
}))

import { Composer } from '@/app/o/[organizationId]/home/components/composer/composer'
import { useFileAttachments } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'

let root: Root
let container: HTMLDivElement
let queryClient: QueryClient

beforeEach(() => {
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
    audioLevelsRef: { current: new Float32Array(5) },
    toggleListening: mocks.toggleListening,
    resetTranscript: mocks.resetTranscript,
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  queryClient.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function render(
  isInitialView: boolean,
  initialValue = 'Summarize',
  requestMode: 'agent' | 'assistant' = 'assistant',
  controls: Pick<
    ComponentProps<typeof Composer>,
    | 'isSending'
    | 'showModeSelector'
    | 'onModeChange'
    | 'restoredContexts'
    | 'assistantSearchLevel'
    | 'onAssistantSearchLevelChange'
  > = { isSending: false }
) {
  function Harness() {
    const [value, setValue] = useState(initialValue)
    const [assistantSearchLevel, setAssistantSearchLevel] = useState(
      controls.assistantSearchLevel ?? 'adaptive'
    )
    const files = useFileAttachments({
      userId: 'user-a',
      organizationId: 'organization-a',
      requestMode,
    })
    return (
      <Composer
        requestMode={requestMode}
        assistantSearchLevel={assistantSearchLevel}
        onAssistantSearchLevelChange={
          controls.onAssistantSearchLevelChange ?? setAssistantSearchLevel
        }
        showModeSelector={controls.showModeSelector}
        onModeChange={controls.onModeChange}
        restoredContexts={controls.restoredContexts}
        value={value}
        files={files}
        onChange={setValue}
        isInitialView={isInitialView}
        isSending={controls.isSending}
        onStop={vi.fn()}
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
        <Harness />
      </QueryClientProvider>
    )
  )
}

describe('organization voice composer', () => {
  it.each([true, false])(
    'appends dictation and clears its prefix on send (initial: %s)',
    async (isInitialView) => {
      await render(isInitialView)
      const mic = container.querySelector<HTMLButtonElement>('button[aria-label="Voice input"]')!
      expect(container.querySelector('[aria-label="Reasoning effort"]')).toBeNull()
      expect(container.querySelector('[aria-label="Fast mode"]')).toBeNull()
      expect(mic.previousElementSibling?.getAttribute('aria-label')).toBe('Search level')
      expect(mic.parentElement?.nextElementSibling?.getAttribute('aria-label')).toBe('Send')
      await act(async () => mic.click())
      expect(mocks.toggleListening).toHaveBeenCalledOnce()
      const speech = mocks.speech.mock.calls.at(-1)![0]
      expect(speech.organizationId).toBe('organization-a')
      await act(async () => speech.onTranscript('the'))
      await act(async () => speech.onTranscript('the release'))
      expect(
        container.querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="Ask Sim"]')!
          .value
      ).toBe('Summarize the release')
      expect(mocks.submit).not.toHaveBeenCalled()
      await act(async () => {
        container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click()
      })
      expect(mocks.submit).toHaveBeenCalledWith('Summarize the release', [])
      expect(mocks.resetTranscript).toHaveBeenCalledOnce()
      await act(async () => mocks.speech.mock.calls.at(-1)![0].onTranscript('Next question'))
      expect(
        container.querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="Ask Sim"]')!
          .value
      ).toBe('Next question')
    }
  )

  it('hides voice input when unavailable', async () => {
    mocks.speech.mockImplementation(() => ({
      isSupported: false,
      isListening: false,
      audioLevelsRef: { current: new Float32Array(5) },
      toggleListening: mocks.toggleListening,
      resetTranscript: mocks.resetTranscript,
    }))
    await render(true)
    expect(container.querySelector('button[aria-label="Voice input"]')).toBeNull()
  })
})

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

describe('organization image composer', () => {
  it.each([true, false])(
    'pastes and submits an image without text (initial: %s)',
    async (initial) => {
      await render(initial, '')
      const image = new File(['image'], 'screenshot.png', { type: 'image/png' })
      const event = await paste([image])
      expect(event.defaultPrevented).toBe(true)
      expect(mocks.upload).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: 'mothership_attachment',
          organizationId: 'organization-a',
          file: image,
        })
      )
      expect(container.querySelector('img')?.getAttribute('alt')).toBe('screenshot.png')
      await act(async () =>
        container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click()
      )
      expect(mocks.submit).toHaveBeenCalledWith('', [
        expect.objectContaining({
          key: 'assistant/organization-a/user-a/image-a/screenshot.png',
          uploading: false,
        }),
      ])
      expect(container.querySelector('img')).toBeNull()
    }
  )

  it('leaves ordinary text paste to the textarea', async () => {
    await render(true)
    expect((await paste([])).defaultPrevented).toBe(false)
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('accepts dropped images through the same upload flow', async () => {
    await render(false)
    const image = new File(['image'], 'dropped.png', { type: 'image/png' })
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { files: fileList([image]) } })
    await act(async () =>
      container
        .querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="Ask Sim"]')!
        .dispatchEvent(drop)
    )
    expect(drop.defaultPrevented).toBe(true)
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ file: image }))
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('dropped.png')
  })

  it('blocks Send and Enter until an image upload finishes', async () => {
    let finish!: (value: { key: string; path: string }) => void
    mocks.upload.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    await render(true)
    await paste([new File(['image'], 'screenshot.png', { type: 'image/png' })])
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.disabled).toBe(
      true
    )
    await act(async () =>
      container
        .querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="Ask Sim"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    )
    expect(mocks.submit).not.toHaveBeenCalled()
    await act(async () => finish({ key: 'image-key', path: '/image-path' }))
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.disabled).toBe(
      false
    )
  })

  it('lets a pasted attachment be removed before sending without an attachment button', async () => {
    await render(true, '')
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    expect(container.querySelector('[aria-label="Attach images"]')).toBeNull()
    expect(input.accept).toContain('image/png')
    await paste([new File(['image'], 'screenshot.png', { type: 'image/png' })])
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Remove screenshot.png"]')!
        .click()
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.disabled).toBe(
      true
    )
  })
})

it('uploads an agent document with explicit mode while Assistant remains image-only', async () => {
  const toastError = vi.spyOn(toast, 'error').mockReturnValue('toast-id')
  const document = new File(['document'], 'notes.txt', { type: 'text/plain' })
  await render(true, '', 'assistant')
  await paste([document])
  expect(mocks.upload).not.toHaveBeenCalled()
  expect(toastError).toHaveBeenCalledWith('Attach PNG, JPEG, GIF, or WebP images.')
  await render(true, '', 'agent')
  await paste([document])
  expect(mocks.upload).toHaveBeenCalledWith(
    expect.objectContaining({
      file: document,
      organizationId: 'organization-a',
      requestMode: 'agent',
    })
  )
  expect(container.querySelector('input[type="file"]')?.getAttribute('accept')).toContain('.txt')
  expect(container.querySelector('button[aria-label="Reasoning effort"]')).not.toBeNull()
})

it('shows a flat custom skill row with its workspace label and sends scoped context', async () => {
  await render(true, '', 'agent')
  const slash = container.querySelector<HTMLButtonElement>('button[aria-label="Skills"]')!
  expect(slash.previousElementSibling?.getAttribute('aria-label')).toBe('Attach file')
  expect(slash.previousElementSibling?.previousElementSibling?.getAttribute('aria-label')).toBe(
    'Add resources'
  )
  await act(async () => slash.click())
  expect(mocks.skillQuery).toHaveBeenCalledExactlyOnceWith('workspace-a')
  expect(document.body.textContent).not.toContain('Other org')
  expect(document.body.textContent).not.toContain('Choose a workspace')
  const skill = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === 'reviewTeam'
  )!
  expect(skill).toBeDefined()
  await act(async () => skill.click())
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click()
  )
  expect(mocks.submit.mock.calls.at(-1)?.[0]).toBe('/review ')
  expect(mocks.contexts).toHaveBeenLastCalledWith([
    { kind: 'skill', skillId: 'skill-a', label: 'review', workspaceId: 'workspace-a' },
  ])
})

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
        <Harness />
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

it.each([true, false])(
  'hides Build controls in Search (can choose mode: %s)',
  async (canChoose) => {
    await render(true, '', 'assistant', {
      isSending: false,
      showModeSelector: canChoose,
      onModeChange: vi.fn(),
    })
    expect(mocks.skillQuery).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-label="Skills"]')).toBeNull()
    expect(container.querySelector('[aria-label="Add resources"]')).toBeNull()
    expect(container.querySelector('[aria-label="Reasoning effort"]')).toBeNull()
    expect(container.querySelector('[aria-label="Fast mode"]')).toBeNull()
    expect(Boolean(container.querySelector('[aria-label="Conversation mode"]'))).toBe(canChoose)
    expect(container.querySelector('[aria-label="Attach images"]')).toBeNull()
  }
)

it('opens the shared flat organization resource menu and preserves the selected owner', async () => {
  await render(true, '', 'agent')
  const plus = container.querySelector<HTMLButtonElement>('button[aria-label="Add resources"]')!
  await act(async () => plus.click())
  expect(mocks.openResourceMenu).toHaveBeenCalledOnce()
  const menu = mocks.resourceMenu.mock.calls.at(-1)![0]
  expect(menu.organizationId).toBe('organization-a')
  expect(menu.workspaceId).toBe('')
  expect(document.body.textContent).not.toContain('Choose a workspace')
  await act(async () =>
    menu.onResourceSelect({
      type: 'file',
      id: 'report.txt',
      title: 'Report',
      workspaceId: 'workspace-a',
    })
  )
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click()
  )
  expect(mocks.contexts).toHaveBeenLastCalledWith([
    { kind: 'file', fileId: 'report.txt', label: 'Report', workspaceId: 'workspace-a' },
  ])
})

it('deduplicates canonical built-ins returned by multiple accessible workspace skill lists', async () => {
  mocks.workspaces.push({
    id: 'workspace-b',
    name: 'Second team',
    organizationId: 'organization-a',
    workspaceMode: 'organization',
  })
  mocks.skillQuery.mockResolvedValue([
    {
      id: 'builtin-research',
      workspaceId: null,
      userId: null,
      name: 'research',
      description: '',
      content: '',
      canEdit: false,
      readOnly: true,
      createdAt: '',
      updatedAt: '',
    },
  ])
  await render(true, '', 'agent')
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Skills"]')!.click()
  )
  expect(mocks.skillQuery.mock.calls.map(([workspaceId]) => workspaceId).sort()).toEqual([
    'workspace-a',
    'workspace-b',
  ])
  const researchRows = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(
    (row) => row.textContent === 'research'
  )
  expect(researchRows).toHaveLength(1)
  expect(document.body.textContent).not.toContain('Second team')
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

it('shows Build with a chevron in the shared chip and text-only modes in its menu', async () => {
  const onModeChange = vi.fn()
  await render(true, 'Preserved draft', 'agent', {
    isSending: false,
    showModeSelector: true,
    onModeChange,
  })
  const mode = container.querySelector<HTMLButtonElement>('[aria-label="Conversation mode"]')!
  expect(mode.parentElement?.previousElementSibling).toBeNull()
  expect(mode.parentElement?.nextElementSibling?.getAttribute('aria-label')).toBe('Add resources')
  expect(mode.textContent).toBe('Build')
  expect(mode.querySelectorAll('svg')).toHaveLength(1)
  await act(async () =>
    mode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  )
  const search = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === 'Search'
  )!
  expect(search.querySelector('svg')).toBeNull()
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
  await act(async () => search.click())
  expect(onModeChange).toHaveBeenCalledExactlyOnceWith('assistant')
  expect(
    container.querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="Ask Sim"]')!.value
  ).toBe('Preserved draft')
})

it('allows changing the next message mode while a response is streaming', async () => {
  const onModeChange = vi.fn()
  await render(false, 'Next question', 'agent', {
    isSending: true,
    showModeSelector: true,
    onModeChange,
  })
  const mode = container.querySelector<HTMLButtonElement>('[aria-label="Conversation mode"]')!
  expect(mode.disabled).toBe(false)
  await act(async () =>
    mode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  )
  const search = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === 'Search'
  )!
  await act(async () => search.click())
  expect(onModeChange).toHaveBeenCalledExactlyOnceWith('assistant')
  expect(
    container.querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="Ask Sim"]')!.value
  ).toBe('Next question')
  expect(mocks.submit).not.toHaveBeenCalled()
})

it('opens resources, attaches files, and inserts skills while streaming', async () => {
  await render(false, 'Next question', 'agent', { isSending: true })
  for (const label of ['Add resources', 'Attach file', 'Skills']) {
    expect(container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.disabled).toBe(
      false
    )
  }
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Add resources"]')!.click()
  )
  expect(mocks.openResourceMenu).toHaveBeenCalled()
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
  const selectFile = vi.spyOn(input, 'click')
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Attach file"]')!.click()
  )
  expect(selectFile).toHaveBeenCalledOnce()
  await paste([new File(['image'], 'follow-up.png', { type: 'image/png' })])
  expect(container.querySelector('img')?.getAttribute('alt')).toBe('follow-up.png')
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Skills"]')!.click()
  )
  const research = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === 'research'
  )!
  await act(async () => research.click())
  await act(async () =>
    container
      .querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="Ask Sim"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  )
  expect(mocks.submit).toHaveBeenCalledWith(expect.stringContaining('/research'), [
    expect.objectContaining({ name: 'follow-up.png', uploading: false }),
  ])
  expect(mocks.contexts).toHaveBeenCalledWith([
    expect.objectContaining({ kind: 'skill', skillId: 'builtin-research' }),
  ])
})

it.each(['skill', 'file'] as const)(
  'keeps a Build draft intact when %s context cannot move to Search',
  async (kind) => {
    const onModeChange = vi.fn()
    const info = vi.spyOn(toast, 'info').mockReturnValue('notice')
    await render(true, kind === 'skill' ? '/review Draft' : 'Document draft', 'agent', {
      isSending: false,
      showModeSelector: true,
      onModeChange,
      restoredContexts:
        kind === 'skill'
          ? [{ kind: 'skill', skillId: 'skill-a', label: 'review', workspaceId: 'workspace-a' }]
          : undefined,
    })
    if (kind === 'file')
      await paste([new File(['document'], 'note.pdf', { type: 'application/pdf' })])
    const before = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '[aria-label="Ask Sim"]'
    )!.value
    const mode = container.querySelector<HTMLButtonElement>('[aria-label="Conversation mode"]')!
    await act(async () =>
      mode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    )
    const search = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === 'Search'
    )!
    await act(async () => search.click())
    expect(onModeChange).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith(
      'Remove resource and skill mentions and non-image attachments before switching to Search.'
    )
    expect(
      container.querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="Ask Sim"]')!
        .value
    ).toBe(before)
  }
)

describe('Search levels', () => {
  it('leaves Shift+Enter and composition to the editor, and submits multiline text on Enter', async () => {
    await render(true, 'First line\nSecond line')
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="Ask Sim"]')!
    for (const options of [{ shiftKey: true }, { isComposing: true }]) {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        ...options,
      })
      await act(async () => input.dispatchEvent(event))
      expect(event.defaultPrevented).toBe(false)
      expect(mocks.submit).not.toHaveBeenCalled()
    }
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    )
    expect(mocks.submit).toHaveBeenCalledWith('First line\nSecond line', [])
  })

  it.each(['Fast', 'Auto', 'Max'])(
    'selects %s without losing the draft or image',
    async (label) => {
      await render(true, 'Preserved question')
      await paste([new File(['image'], 'screenshot.png', { type: 'image/png' })])
      const picker = container.querySelector<HTMLButtonElement>('[aria-label="Search level"]')!
      expect(picker.textContent).toBe('Auto')
      expect(picker.nextElementSibling?.getAttribute('aria-label')).toBe('Voice input')
      await act(async () =>
        picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      )
      const option = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
        (item) => item.textContent?.startsWith(label)
      )!
      await act(async () => option.click())
      expect(picker.textContent).toBe(label)
      expect(
        container.querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="Ask Sim"]')!
          .value
      ).toBe('Preserved question')
      expect(container.querySelector('img')?.getAttribute('alt')).toBe('screenshot.png')
      expect(mocks.submit).not.toHaveBeenCalled()
    }
  )

  it('keeps the Search editor between the left and right controls in one row', async () => {
    await render(true, '', 'assistant', {
      isSending: false,
      showModeSelector: true,
      onModeChange: vi.fn(),
    })
    const mode = container.querySelector('[aria-label="Conversation mode"]')!
    const row = mode.parentElement!.parentElement!.parentElement!
    expect(
      row.querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="Ask Sim"]')
    ).not.toBeNull()
    expect(mode.textContent).toBe('')
    expect(mode.querySelectorAll('svg')).toHaveLength(2)
    expect(mode.parentElement?.nextElementSibling).toBeNull()
    expect(row.querySelector('[aria-label="Search level"]')?.textContent).toBe('Auto')
  })
})

it('offers only the five Build efforts and changes effort without losing the draft', async () => {
  useMothershipEffortStore.getState().setEffort('high')
  await render(true, 'Build draft', 'agent')
  const picker = container.querySelector<HTMLButtonElement>('[aria-label="Reasoning effort"]')!
  expect(picker?.textContent).toBe('High')
  expect(container.textContent).not.toMatch(/GPT-6 Astra|Opus/)
  await act(async () =>
    picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  )
  const options = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
  expect(options.map((item) => item.textContent)).toEqual([
    'Low',
    'Medium',
    'High',
    'Extra High',
    'Max',
  ])
  expect(options[2].getAttribute('aria-checked')).toBe('true')
  await act(async () => options[3].click())
  expect(picker.textContent).toBe('Extra High')
  expect(useMothershipEffortStore.getState()).toMatchObject({
    effort: 'xhigh',
    modelSelection: { model: 'gpt-6-astra' },
  })
  expect(container.querySelector<HTMLInputElement>('[aria-label="Ask Sim"]')!.value).toBe(
    'Build draft'
  )
  expect(mocks.submit).not.toHaveBeenCalled()
})

it('keeps Build Fast independent of Search levels', async () => {
  useMothershipEffortStore.getState().setFastMode(false)
  await render(true, 'Build', 'agent')
  expect(container.querySelector('[aria-label="Search level"]')).toBeNull()
  const fast = container.querySelector<HTMLButtonElement>('[aria-label="Fast mode"]')!
  await act(async () => fast.click())
  expect(useMothershipEffortStore.getState().modelSelection.fastMode).toBe(true)
  expect(container.querySelector('[aria-label="Reasoning effort"]')).not.toBeNull()
  await act(async () => useMothershipEffortStore.getState().setFastMode(false))
})

it('offers only Fast, Auto, and Max search levels', async () => {
  await render(true, '', 'assistant', { isSending: false })
  const picker = container.querySelector<HTMLButtonElement>('[aria-label="Search level"]')!
  await act(async () =>
    picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  )
  expect(
    [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].map(
      (item) => item.textContent
    )
  ).toEqual(['Fast', 'Auto', 'Max'])
})
