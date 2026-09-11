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
}))

vi.mock('@/hooks/use-speech-to-text', () => ({ useSpeechToText: mocks.speech }))
vi.mock('@/hooks/use-animated-placeholder', () => ({ useAnimatedPlaceholder: () => 'Ask Sim to' }))
vi.mock('@/hooks/use-chat-input-focus', () => ({ useChatInputFocus: vi.fn() }))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: () => ({ organization: { id: 'organization-a' } }),
}))

import { Composer } from '@/app/o/[organizationId]/home/components/composer/composer'

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
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
})

async function render(isInitialView: boolean) {
  function Harness() {
    const [value, setValue] = useState('Summarize')
    return (
      <Composer
        value={value}
        onChange={setValue}
        isInitialView={isInitialView}
        isSending={false}
        onStop={vi.fn()}
        onSubmit={() => {
          mocks.submit(value)
          setValue('')
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
      expect(mocks.submit).toHaveBeenCalledWith('Summarize the release')
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
