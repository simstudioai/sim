import { useEffect, useRef, useState } from 'react'

const PLACEHOLDER_PREFIX = 'Ask Sim to '
const PLACEHOLDER_SUFFIXES = [
  'respond to my emails...',
  'find and track leads...',
  'DM me Linear updates on Slack...',
  'track GitHub commits...',
] as const

const TYPE_SPEED_MS = 60
const DELETE_SPEED_MS = 35
const PAUSE_AFTER_TYPING_MS = 2000
const PAUSE_AFTER_DELETING_MS = 400

export function useAnimatedPlaceholder(enabled = true): string {
  const [text, setText] = useState(PLACEHOLDER_PREFIX)
  const stateRef = useRef({
    suffixIndex: 0,
    charIndex: 0,
    phase: 'typing' as 'typing' | 'paused' | 'deleting' | 'waiting',
  })

  useEffect(() => {
    if (!enabled) return

    const tick = () => {
      const s = stateRef.current
      const suffix = PLACEHOLDER_SUFFIXES[s.suffixIndex]

      switch (s.phase) {
        case 'typing': {
          s.charIndex++
          setText(PLACEHOLDER_PREFIX + suffix.slice(0, s.charIndex))
          if (s.charIndex >= suffix.length) {
            s.phase = 'paused'
            return PAUSE_AFTER_TYPING_MS
          }
          return TYPE_SPEED_MS
        }
        case 'paused': {
          s.phase = 'deleting'
          return DELETE_SPEED_MS
        }
        case 'deleting': {
          s.charIndex--
          setText(PLACEHOLDER_PREFIX + suffix.slice(0, s.charIndex))
          if (s.charIndex <= 0) {
            s.phase = 'waiting'
            return PAUSE_AFTER_DELETING_MS
          }
          return DELETE_SPEED_MS
        }
        case 'waiting': {
          s.suffixIndex = (s.suffixIndex + 1) % PLACEHOLDER_SUFFIXES.length
          s.charIndex = 0
          s.phase = 'typing'
          return TYPE_SPEED_MS
        }
      }
    }

    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      const delay = tick()
      timer = setTimeout(schedule, delay)
    }
    timer = setTimeout(schedule, TYPE_SPEED_MS)

    return () => clearTimeout(timer)
  }, [enabled])

  return enabled ? text : PLACEHOLDER_PREFIX
}
