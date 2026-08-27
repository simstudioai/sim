'use client'

import { memo, type RefObject, useEffect, useRef } from 'react'
import { Button, cn, Tooltip, usePrefersReducedMotion } from '@sim/emcn'
import { Mic } from '@sim/emcn/icons'

const WAVEFORM_BAR_COUNT = 5
const WAVEFORM_MIN_HEIGHT = 3
const WAVEFORM_MAX_HEIGHT = 14
const WAVEFORM_CENTER = 9
const WAVEFORM_EASING = 0.24

interface MicButtonProps {
  isListening: boolean
  audioLevelsRef: RefObject<Float32Array>
  onToggle: () => void
}

interface VoiceWaveformProps {
  audioLevelsRef: RefObject<Float32Array>
  isListening: boolean
}

function VoiceWaveform({ audioLevelsRef, isListening }: VoiceWaveformProps) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const barRefs = useRef<Array<SVGLineElement | null>>([])

  useEffect(() => {
    if (!isListening || prefersReducedMotion) return

    const heights = new Float32Array(WAVEFORM_BAR_COUNT).fill(WAVEFORM_MIN_HEIGHT)
    let animationFrameId = 0

    const draw = () => {
      const levels = audioLevelsRef.current

      for (let index = 0; index < WAVEFORM_BAR_COUNT; index++) {
        const level = levels?.[index] ?? 0
        const targetHeight =
          WAVEFORM_MIN_HEIGHT +
          Math.sqrt(Math.max(0, level)) * (WAVEFORM_MAX_HEIGHT - WAVEFORM_MIN_HEIGHT)
        heights[index] += (targetHeight - heights[index]) * WAVEFORM_EASING

        const bar = barRefs.current[index]
        if (!bar) continue
        const halfHeight = heights[index] / 2
        bar.setAttribute('y1', String(WAVEFORM_CENTER - halfHeight))
        bar.setAttribute('y2', String(WAVEFORM_CENTER + halfHeight))
      }

      animationFrameId = window.requestAnimationFrame(draw)
    }

    animationFrameId = window.requestAnimationFrame(draw)
    return () => window.cancelAnimationFrame(animationFrameId)
  }, [audioLevelsRef, isListening, prefersReducedMotion])

  return (
    <svg aria-hidden viewBox='0 0 18 18' className='size-[18px] overflow-hidden'>
      {Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
        const x = 3 + index * 3
        return (
          <line
            key={x}
            ref={(element) => {
              barRefs.current[index] = element
            }}
            x1={x}
            x2={x}
            y1={WAVEFORM_CENTER - WAVEFORM_MIN_HEIGHT / 2}
            y2={WAVEFORM_CENTER + WAVEFORM_MIN_HEIGHT / 2}
            stroke='currentColor'
            strokeLinecap='round'
            strokeWidth='1.7'
          />
        )
      })}
    </svg>
  )
}

export const MicButton = memo(function MicButton({
  isListening,
  audioLevelsRef,
  onToggle,
}: MicButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          type='button'
          variant={isListening ? 'active' : 'ghost'}
          onClick={onToggle}
          aria-label={isListening ? 'Stop listening' : 'Voice input'}
          aria-pressed={isListening}
          className={cn(
            'relative size-[28px] overflow-hidden rounded-full p-0 transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100',
            !isListening &&
              'text-[var(--text-icon)] hover-hover:bg-[var(--surface-hover)] hover-hover:text-[var(--text-icon)]'
          )}
        >
          <span
            className={cn(
              'absolute inset-0 flex items-center justify-center transition-[opacity,filter,scale] duration-300 [transition-timing-function:cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
              isListening ? 'scale-100 opacity-100 blur-0' : 'scale-[0.25] opacity-0 blur-[4px]'
            )}
          >
            <VoiceWaveform audioLevelsRef={audioLevelsRef} isListening={isListening} />
          </span>
          <Mic
            className={cn(
              'size-[16px] transition-[opacity,filter,scale] duration-300 [transition-timing-function:cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
              isListening ? 'scale-[0.25] opacity-0 blur-[4px]' : 'scale-100 opacity-100 blur-0'
            )}
          />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side='top'>{isListening ? 'Stop listening' : 'Voice input'}</Tooltip.Content>
    </Tooltip.Root>
  )
})
