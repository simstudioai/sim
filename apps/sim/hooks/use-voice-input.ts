'use client'

import { useCallback, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { diffWordsWithSpace } from 'diff'
import { getDesktopBridge } from '@/lib/desktop'
import { type SpeechToTextError, useSpeechToText } from '@/hooks/use-speech-to-text'

interface UseVoiceInputProps {
  workspaceId?: string
  organizationId?: string
  getValue: () => string
  onChange: (value: string) => void
  onUsageLimitExceeded?: (message?: string, isMemberLimit?: boolean) => void
}

interface TextEdit {
  from: number
  to: number
  insert: string
}

function textChanges(before: string, after: string): TextEdit[] {
  const parts = diffWordsWithSpace(before, after, { maxEditLength: 256 })
  if (!parts) return [{ from: 0, to: before.length, insert: after }]
  const edits: TextEdit[] = []
  let position = 0
  let edit: TextEdit | undefined
  for (const part of parts) {
    if (part.added || part.removed) {
      edit ??= { from: position, to: position, insert: '' }
      if (part.added) edit.insert += part.value
      if (part.removed) {
        position += part.value.length
        edit.to = position
      }
    } else {
      if (edit) edits.push(edit)
      edit = undefined
      position += part.value.length
    }
  }
  if (edit) edits.push(edit)
  return edits
}

/** Rebase independent speech updates around manual edits; the user's text wins conflicts. */
function mergeTranscript(previous: string, next: string, current: string): string {
  if (current === previous) return next
  if (next === previous) return current

  const speechEdits = textChanges(previous, next)
  const manualEdits = textChanges(previous, current)
  let result = current
  for (const speech of speechEdits.reverse()) {
    let offset = 0
    let conflict = false
    for (const edit of manualEdits) {
      if (speech.to <= edit.from && speech.from < edit.from) continue
      if (speech.from >= edit.to && (speech.from > edit.from || /^\s/.test(speech.insert))) {
        offset += edit.insert.length - (edit.to - edit.from)
      } else {
        conflict = true
        break
      }
    }
    if (!conflict) {
      result =
        result.slice(0, speech.from + offset) + speech.insert + result.slice(speech.to + offset)
    }
  }
  return current ? result : result.trimStart()
}

/** Shares draft appending and microphone recovery across chat and search inputs. */
export function useVoiceInput({
  workspaceId,
  organizationId,
  getValue,
  onChange,
  onUsageLimitExceeded = (message) => toast.error(message || 'You are out of credits.'),
}: UseVoiceInputProps) {
  const prefixRef = useRef('')
  const previousTranscriptValueRef = useRef('')
  const getValueRef = useRef(getValue)
  getValueRef.current = getValue
  const [permissionHelpOpen, setPermissionHelpOpen] = useState(false)

  function handleSpeechError(error: SpeechToTextError) {
    if (error === 'microphone-blocked') {
      const desktopBridge = getDesktopBridge()
      if (desktopBridge) {
        const { openMicrophoneSettings } = desktopBridge
        toast.error(
          'Microphone access is blocked. Allow Sim to use the microphone in your system privacy settings.',
          openMicrophoneSettings
            ? {
                action: {
                  label: 'Open Settings',
                  onClick: () => void openMicrophoneSettings(),
                },
              }
            : undefined
        )
      } else {
        toast.error('Microphone access is blocked. Allow it for this site and try again.', {
          action: {
            label: 'Show steps',
            onClick: () => setPermissionHelpOpen(true),
          },
        })
      }
      return
    }
    if (error === 'microphone-unavailable') {
      toast.error('No microphone found. Connect one and try again.')
      return
    }
    toast.error('Could not start voice input. Try again.')
  }

  const {
    toggleListening: rawToggle,
    resetTranscript: rawReset,
    ...speech
  } = useSpeechToText({
    workspaceId,
    organizationId,
    onTranscript: (text) => {
      const next = prefixRef.current ? `${prefixRef.current} ${text}` : text
      const value = mergeTranscript(previousTranscriptValueRef.current, next, getValueRef.current())
      previousTranscriptValueRef.current = next
      onChange(value)
    },
    onUsageLimitExceeded,
    onError: handleSpeechError,
  })

  const toggleListening = useCallback(() => {
    if (!speech.isListening) {
      prefixRef.current = getValueRef.current()
      previousTranscriptValueRef.current = prefixRef.current
    }
    rawToggle()
  }, [speech.isListening, rawToggle])

  const resetTranscript = useCallback(() => {
    prefixRef.current = ''
    previousTranscriptValueRef.current = ''
    rawReset()
  }, [rawReset])

  return {
    ...speech,
    toggleListening,
    resetTranscript,
    permissionHelpOpen,
    setPermissionHelpOpen,
  }
}
