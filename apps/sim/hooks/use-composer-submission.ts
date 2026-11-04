'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import type { ChatContext } from '@/stores/panel'

type CommitSubmission = () => undefined | false

export type PrepareChatSubmission = (
  text: string,
  contexts: ChatContext[] | undefined,
  send: (submission: { message: string; contexts: ChatContext[] }) => undefined | false,
  reference?: boolean
) => undefined | false | PendingComposerSubmission

/** Defers clearing the editor until a surface has the context needed to send this turn. */
export class PendingComposerSubmission {
  constructor(readonly ready: Promise<CommitSubmission | false>) {}
}

interface UseComposerSubmissionProps {
  scope?: string
  mode?: string
}

export function useComposerSubmission({ scope, mode }: UseComposerSubmissionProps) {
  const active = useRef<PendingComposerSubmission | null>(null)
  const focusAfterSend = useRef<{
    input: HTMLTextAreaElement
    initiator: Element | null
  } | null>(null)
  const [pending, setPending] = useState(false)

  useLayoutEffect(() => {
    setPending(false)
    return () => {
      active.current = null
      focusAfterSend.current = null
    }
  }, [scope, mode])

  useLayoutEffect(() => {
    if (pending) return
    const focus = focusAfterSend.current
    focusAfterSend.current = null
    if (
      focus?.input.isConnected &&
      document.hasFocus() &&
      (document.activeElement === document.body || document.activeElement === focus.initiator)
    ) {
      focus.input.focus({ preventScroll: true })
    }
  }, [pending])

  const accept = useCallback(
    (
      submit: () => unknown,
      clear: () => void,
      unchanged: () => boolean,
      input: HTMLTextAreaElement | null
    ) => {
      if (active.current) return
      const result = submit()
      if (!(result instanceof PendingComposerSubmission)) {
        if (result !== false) clear()
        return
      }
      active.current = result
      focusAfterSend.current = input ? { input, initiator: document.activeElement } : null
      setPending(true)
      void result.ready
        .then((commit) => {
          if (active.current !== result || !commit) return
          if (!unchanged()) {
            toast.info('Your draft changed while the page was being read. Send again to continue.')
            return
          }
          if (commit() !== false) clear()
        })
        .catch((error: unknown) => {
          if (active.current === result)
            toast.error(getErrorMessage(error, 'Could not attach the current page.'))
        })
        .finally(() => {
          if (active.current === result) {
            active.current = null
            setPending(false)
          }
        })
    },
    []
  )
  return { pending, accept }
}
