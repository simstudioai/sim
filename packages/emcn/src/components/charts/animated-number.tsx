'use client'

import { useEffect, useMemo } from 'react'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'

interface AnimatedNumberProps {
  value: number
  maximumFractionDigits?: number
}

/** Counts from the displayed value, preserving continuity when an update interrupts the animation. */
export function AnimatedNumber({ value, maximumFractionDigits = 2 }: AnimatedNumberProps) {
  const displayed = useMotionValue(value)
  const reducedMotion = useReducedMotion()
  const formatter = useMemo(
    () => new Intl.NumberFormat(undefined, { maximumFractionDigits }),
    [maximumFractionDigits]
  )
  const formatted = useTransform(displayed, (current) => formatter.format(current))

  useEffect(() => {
    if (displayed.get() === value) return
    if (reducedMotion) {
      displayed.jump(value)
      return
    }
    const animation = animate(displayed, value, {
      duration: 0.28,
      ease: 'easeInOut',
    })
    return () => animation.stop()
  }, [displayed, value, reducedMotion])

  return (
    <span className='inline-grid tabular-nums'>
      <motion.span aria-hidden='true'>{formatted}</motion.span>
      <span className='sr-only'>{formatter.format(value)}</span>
    </span>
  )
}
