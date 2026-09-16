/** @vitest-environment jsdom */
import { act, type ComponentProps, useState } from 'react'
import { toast } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { useSpeechToText } from '@/hooks/use-speech-to-text'

const mocks = vi.hoisted(() => ({
  speech: vi.fn<typeof useSpeechToText>(),
  toggleListening: vi.fn(),
  resetTranscript: vi.fn(),
  submit: vi.fn(),
  contexts: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('@/hooks/queries/workspace', () => ({
  useWorkspacesQuery: () => ({
    data: [
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
  }),
}))
vi.mock('@/hooks/queries/skills', () => ({
  useSkills: (workspaceId: string) => ({
    data:
      workspaceId === 'workspace-a'
        ? [{ id: 'skill-a', name: 'review', description: 'Review a draft' }]
        : [],
  }),
}))
vi.mock('@/hooks/queries/mcp', () => ({ useMcpToolServers: () => ({ data: [] }) }))
vi.mock('@/blocks/integration-matcher', () => ({
  getIntegrationMatcher: () => ({ regex: null, byName: new Map() }),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/user-input/components/plus-menu-dropdown/plus-menu-dropdown',
  () => ({ PlusMenuDropdown: () => null })
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

beforeEach(() => {
  vi.clearAllMocks()
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
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function render(
  isInitialView: boolean,
  initialValue = 'Summarize',
  requestMode: 'agent' | 'assistant' = 'assistant',
  controls: Pick<
    ComponentProps<typeof Composer>,
    'isSending' | 'showModeSelector' | 'onModeChange' | 'modeChangeDisabled' | 'restoredContexts'
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
        modeChangeDisabled={controls.modeChangeDisabled}
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
  await act(async () => root.render(<Harness />))
}

describe('organization voice composer', () => {
  it.each([true, false])(
    'appends dictation and clears its prefix on send (initial: %s)',
    async (isInitialView) => {
      await render(isInitialView)
      const mic = container.querySelector<HTMLButtonElement>('button[aria-label="Voice input"]')!
      expect(container.querySelector('[aria-label="Model and reasoning effort"]')).toBeNull()
      expect(container.querySelector('[aria-label="Fast mode"]')).toBeNull()
      expect(mic.nextElementSibling?.getAttribute('aria-label')).toBe('Send')
      await act(async () => mic.click())
      expect(mocks.toggleListening).toHaveBeenCalledOnce()
      const speech = mocks.speech.mock.calls.at(-1)![0]
      expect(speech.organizationId).toBe('organization-a')
      await act(async () => speech.onTranscript('the'))
      await act(async () => speech.onTranscript('the release'))
      expect(container.querySelector('textarea')!.value).toBe('Summarize the release')
      expect(mocks.submit).not.toHaveBeenCalled()
      await act(async () => {
        container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click()
      })
      expect(mocks.submit).toHaveBeenCalledWith('Summarize the release', [])
      expect(mocks.resetTranscript).toHaveBeenCalledOnce()
      await act(async () => mocks.speech.mock.calls.at(-1)![0].onTranscript('Next question'))
      expect(container.querySelector('textarea')!.value).toBe('Next question')
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
  await act(async () => container.querySelector('textarea')!.dispatchEvent(event))
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
    await act(async () => container.querySelector('textarea')!.dispatchEvent(drop))
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
        .querySelector('textarea')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    )
    expect(mocks.submit).not.toHaveBeenCalled()
    await act(async () => finish({ key: 'image-key', path: '/image-path' }))
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.disabled).toBe(
      false
    )
  })

  it('uses the picker and lets an attachment be removed before sending', async () => {
    await render(true, '')
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const click = vi.spyOn(input, 'click')
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Attach images"]')!.click()
    )
    expect(click).toHaveBeenCalledOnce()
    expect(input.accept).toContain('image/png')
    Object.defineProperty(input, 'files', {
      value: fileList([new File(['image'], 'screenshot.png', { type: 'image/png' })]),
    })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
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
  expect(container.querySelector('button[aria-label="Model and reasoning effort"]')).not.toBeNull()
})

it('discovers an organization-owned legacy workspace and sends its scoped skill context', async () => {
  await render(true, '', 'agent')
  const slash = container.querySelector<HTMLButtonElement>('button[aria-label="Skills"]')!
  expect(slash.previousElementSibling?.getAttribute('aria-label')).toBe('Attach file')
  expect(slash.previousElementSibling?.previousElementSibling?.getAttribute('aria-label')).toBe(
    'Add resources'
  )
  await act(async () =>
    slash.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  )
  expect(document.body.textContent).not.toContain('Other org')
  const workspace = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === 'Team'
  )!
  await act(async () => workspace.click())
  const skill = [...document.querySelectorAll<HTMLElement>('button')].find(
    (item) => item.textContent === 'review'
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
  await act(async () => root.render(<Harness />))
  await act(async () => restore())
  expect(container.querySelector('textarea')!.value).toBe('\u2003review fix this')
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
    expect(container.querySelector('[aria-label="Skills"]')).toBeNull()
    expect(container.querySelector('[aria-label="Add resources"]')).toBeNull()
    expect(container.querySelector('[aria-label="Model and reasoning effort"]')).toBeNull()
    expect(container.querySelector('[aria-label="Fast mode"]')).toBeNull()
    expect(Boolean(container.querySelector('[aria-label="Conversation mode"]'))).toBe(canChoose)
    expect(container.querySelector('[aria-label="Attach images"]')).not.toBeNull()
  }
)

it('lists organization-owned legacy workspaces in the resource picker', async () => {
  await render(true, '', 'agent')
  const plus = container.querySelector<HTMLButtonElement>('button[aria-label="Add resources"]')!
  await act(async () =>
    plus.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  )
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
    (item) => item.textContent
  )
  expect(items).toContain('Team')
  expect(items).not.toContain('Other org')
  expect(items).not.toContain('No accessible workspaces')
})

it('offers a text-only controlled mode picker after the staging input controls', async () => {
  const onModeChange = vi.fn()
  await render(true, 'Preserved draft', 'agent', {
    isSending: false,
    showModeSelector: true,
    onModeChange,
  })
  const mode = container.querySelector<HTMLButtonElement>('[aria-label="Conversation mode"]')!
  expect(mode.previousElementSibling?.getAttribute('aria-label')).toBe('Skills')
  expect(mode.querySelector('svg')).toBeNull()
  await act(async () =>
    mode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  )
  const search = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
    (item) => item.textContent === 'Search'
  )!
  expect(search.querySelector('svg')).toBeNull()
  await act(async () => search.click())
  expect(onModeChange).toHaveBeenCalledExactlyOnceWith('assistant')
  expect(container.querySelector('textarea')!.value).toBe('Preserved draft')
})

it('disables the mode picker when the parent has queued messages', async () => {
  await render(true, '', 'agent', {
    isSending: false,
    showModeSelector: true,
    onModeChange: vi.fn(),
    modeChangeDisabled: true,
  })
  expect(
    container.querySelector<HTMLButtonElement>('[aria-label="Conversation mode"]')!.disabled
  ).toBe(true)
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
    const before = container.querySelector('textarea')!.value
    const mode = container.querySelector<HTMLButtonElement>('[aria-label="Conversation mode"]')!
    await act(async () =>
      mode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    )
    const search = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
      (item) => item.textContent === 'Search'
    )!
    await act(async () => search.click())
    expect(onModeChange).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith(
      'Remove resource and skill mentions and non-image attachments before switching to Search.'
    )
    expect(container.querySelector('textarea')!.value).toBe(before)
  }
)
