/** @vitest-environment jsdom */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { useSpeechToText } from '@/hooks/use-speech-to-text'

const mocks = vi.hoisted(() => ({
  speech: vi.fn<typeof useSpeechToText>(),
  toggleListening: vi.fn(),
  resetTranscript: vi.fn(),
  submit: vi.fn(),
  upload: vi.fn(),
}))

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

async function render(isInitialView: boolean, initialValue = 'Summarize') {
  function Harness() {
    const [value, setValue] = useState(initialValue)
    const files = useFileAttachments({ userId: 'user-a', organizationId: 'organization-a' })
    return (
      <Composer
        value={value}
        files={files}
        onChange={setValue}
        isInitialView={isInitialView}
        isSending={false}
        onStop={vi.fn()}
        onSubmit={() => {
          mocks.submit(value, files.attachedFiles)
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
  Object.defineProperty(event, 'clipboardData', { value: { files: fileList(files) } })
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
