'use client'

import { useEffect } from 'react'
import { useAnimatedPlaceholder } from '@/app/workspace/[workspaceId]/home/hooks'

interface AnimatedPlaceholderEffectProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  isInitialView: boolean
}

export function AnimatedPlaceholderEffect({
  textareaRef,
  isInitialView,
}: AnimatedPlaceholderEffectProps) {
  const animatedPlaceholder = useAnimatedPlaceholder(isInitialView)
  const placeholder = isInitialView ? animatedPlaceholder : 'Send message to Sim'

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.placeholder = placeholder
    }
  }, [placeholder, textareaRef])

  return null
}
