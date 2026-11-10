'use client'

import { useEffect, useState } from 'react'
import { toast } from '@/lib/toast/sink'
import { SLASH_TOKEN } from '@/app/(product)/_components/composer/reference-text'
import type { ComposerController } from '@/platform/lib/data/models/composer'

/**
 * How long a send waits on the skill list. The request layer sets no deadline, so this is the only
 * bound on a list that never lands, and the message waits in the field when it passes.
 */
const SKILL_LIST_WAIT_MS = 10_000

interface HeldSend {
  text: string
  /** The list landed and the draft's `/names` were matched against it; the send goes next. */
  landed: boolean
}

interface SkillListHoldOptions {
  composer: Pick<ComposerController, 'skillList' | 'onSkillIntent'>
  text: string
  /** Matches the draft's `/names` against the list that just landed. */
  resync: () => void
  send: () => void
}

/**
 * Holds a send that names a `/skill` until the skill list lands, so the name goes out as the skill
 * rather than as plain text. Editing the draft ends the wait. A list that fails or outlasts the wait
 * leaves the message in the field, and sending that same text again sends it as plain text.
 */
export function useSkillListHold({ composer, text, resync, send }: SkillListHoldOptions) {
  const { skillList } = composer
  const [held, setHeld] = useState<HeldSend | null>(null)
  /** The text the viewer was told would go out as plain text if they sent it again. */
  const [declined, setDeclined] = useState<string | null>(null)
  if (held && !held.landed && held.text !== text) setHeld(null)
  if (declined !== null && declined !== text) setDeclined(null)

  function decline(heldText: string) {
    setHeld(null)
    setDeclined(heldText)
    toast.error(
      "Your skills didn't load, so this wasn't sent. Send again to send it as plain text."
    )
  }

  useEffect(() => {
    if (!held || held.landed) return
    if (skillList === 'failed') {
      decline(held.text)
      return
    }
    if (skillList === 'landed') {
      resync()
      setHeld({ text: held.text, landed: true })
      return
    }
    const timer = setTimeout(() => decline(held.text), SKILL_LIST_WAIT_MS)
    return () => clearTimeout(timer)
  }, [held, skillList])

  // Runs on the render after the resync, so the send carries the skills it matched.
  useEffect(() => {
    if (!held?.landed) return
    setHeld(null)
    send()
  }, [held])

  return {
    holding: held !== null,
    submit: () => {
      if (skillList === 'pending' && SLASH_TOKEN.test(text) && text !== declined) {
        composer.onSkillIntent?.()
        if (held?.text !== text) setHeld({ text, landed: false })
        return
      }
      send()
    },
  }
}
