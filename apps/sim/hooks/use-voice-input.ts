'use client'

import { useCallback, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { getDesktopBridge } from '@/lib/desktop'
import { type SpeechToTextError, useSpeechToText } from '@/hooks/use-speech-to-text'

interface UseVoiceInputProps {
  workspaceId?: string
  organizationId?: string
  getValue: () => string
  onChange: (value: string) => void
  onUsageLimitExceeded?: (message?: string, isMemberLimit?: boolean) => void
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
    onTranscript: (text) => onChange(prefixRef.current ? `${prefixRef.current} ${text}` : text),
    onUsageLimitExceeded,
    onError: handleSpeechError,
  })

  const toggleListening = useCallback(() => {
    if (!speech.isListening) prefixRef.current = getValueRef.current()
    rawToggle()
  }, [speech.isListening, rawToggle])

  const resetTranscript = useCallback(() => {
    prefixRef.current = ''
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
