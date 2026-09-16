/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { useSpeechToText } from '@/hooks/use-speech-to-text'

const mocks = vi.hoisted(() => ({ speech: vi.fn<typeof useSpeechToText>() }))
vi.mock('@/hooks/use-speech-to-text', () => ({ useSpeechToText: mocks.speech }))

import { useVoiceInput } from '@/hooks/use-voice-input'

let root: Root
let container: HTMLDivElement
let value: string
let voice: ReturnType<typeof useVoiceInput>

function Harness() {
  voice = useVoiceInput({
    organizationId: 'organization-a',
    getValue: () => value,
    onChange: (next) => {
      value = next
    },
  })
  return null
}

function transcript(text: string) {
  act(() => mocks.speech.mock.calls.at(-1)![0].onTranscript(text))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.speech.mockReturnValue({
    isListening: false,
    isSupported: true,
    audioLevelsRef: { current: new Float32Array(5) },
    toggleListening: vi.fn(),
    resetTranscript: vi.fn(),
  })
  value = 'Find'
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<Harness />))
  act(() => voice.toggleListening())
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('voice input manual edits', () => {
  it('preserves edits made before the first transcript arrives', () => {
    value = 'Summarize'
    transcript('the report')
    expect(value).toBe('Summarize the report')
  })

  it('preserves a changed prefix while updating partial speech', () => {
    transcript('the repor')
    value = 'Summarize the repor'
    transcript('the report')
    expect(value).toBe('Summarize the report')
    transcript('the report from June')
    expect(value).toBe('Summarize the report from June')
  })

  it.each(['Replacement draft', ''])(
    'preserves a replaced or cleared draft (%s)',
    (replacement) => {
      transcript('the report')
      value = replacement
      transcript('the report')
      expect(value).toBe(replacement)
      transcript('the report from June')
      expect(value).toBe(replacement ? `${replacement} from June` : 'from June')
    }
  )

  it('preserves corrections inside dictated text across later partial updates', () => {
    transcript('the red report')
    value = 'Find the blue report'
    transcript('the red report from June')
    expect(value).toBe('Find the blue report from June')
    transcript('the red report from July')
    expect(value).toBe('Find the blue report from July')
  })

  it('keeps manual suffixes after speech revisions and before new speech', () => {
    transcript('the red report')
    value += ' and notes'
    transcript('the blue report')
    expect(value).toBe('Find the blue report and notes')
    transcript('the blue report from June')
    expect(value).toBe('Find the blue report and notes from June')
  })

  it('prefers the manual correction when speech revises the same word', () => {
    value = ''
    act(() => voice.toggleListening())
    transcript('hel')
    value = 'help'
    transcript('hello')
    expect(value).toBe('help')
    transcript('hello again')
    expect(value).toBe('help again')
  })

  it('keeps appended speech when another revision conflicts with a manual correction', () => {
    transcript('the red report')
    value = 'Find the blue report'
    transcript('the green report from June')
    expect(value).toBe('Find the blue report from June')
    transcript('the green report from June and July')
    expect(value).toBe('Find the blue report from June and July')
  })

  it('preserves separate manual edits around an independently revised word', () => {
    transcript('the red report')
    value = 'Summarize the red report and notes'
    transcript('the green report from June')
    expect(value).toBe('Summarize the green report and notes from June')
  })

  it('starts fresh after the draft and transcript are cleared on submit', () => {
    transcript('the report')
    value = ''
    act(() => voice.resetTranscript())
    transcript('Next question')
    expect(value).toBe('Next question')
  })

  it('continues dictation after a large draft is manually replaced', () => {
    const longTranscript = Array.from({ length: 300 }, (_, index) => `word${index}`).join(' ')
    transcript(longTranscript)
    value = 'New draft'
    transcript(`${longTranscript} next question`)
    expect(value).toBe('New draft next question')
  })
})
