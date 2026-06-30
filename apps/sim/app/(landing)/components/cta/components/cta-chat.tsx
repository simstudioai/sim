'use client'

import { useState } from 'react'
import { LandingPreviewChatInput } from '@/app/(landing)/components/landing-preview/components/landing-preview-chat/chat-input'
import { useLandingSubmit } from '@/app/(landing)/components/landing-preview/hooks/use-landing-submit'
import { useAnimatedPlaceholder } from '@/hooks/use-animated-placeholder'

/**
 * Pre-footer CTA chat input - the page's final conversion surface. A real,
 * interactive copy of the Mothership chat input: the visitor types their first
 * prompt, and {@link useLandingSubmit} stashes it in browser storage and routes
 * to `/signup` so the message survives the auth hop and lands them in Sim. The
 * placeholder cycles the same "Ask Sim to …" examples as the product's home
 * empty state, so the CTA reads as the front door to the workspace.
 */
export function CtaChat() {
  const [value, setValue] = useState('')
  const placeholder = useAnimatedPlaceholder()
  const submit = useLandingSubmit()

  return (
    <div className='w-full max-w-[36rem]'>
      <LandingPreviewChatInput
        value={value}
        onChange={setValue}
        onSubmit={() => submit(value)}
        placeholder={placeholder}
        shadow
      />
    </div>
  )
}
