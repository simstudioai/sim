'use client'

import { useTranslations } from 'next-intl'
import { useCallback } from 'react'
import { blockI18nKey } from '@/lib/i18n/block-key'

/**
 * Translate a block/connector/tool definition string at render time.
 *
 * Definitions are static serialized `.ts` objects, so they can't host a hook.
 * Components that display their strings (block library, config panel, tooltips)
 * call this to localize them: the English source is hashed to a stable key via
 * {@link blockI18nKey} and looked up in the `blocks` namespace, falling back to
 * the original English when no translation exists yet.
 *
 * @example
 *   const tb = useBlockText()
 *   <span>{tb(block.description)}</span>
 */
export function useBlockText(): (text: string | undefined | null) => string {
  const t = useTranslations('blocks')
  return useCallback(
    (text: string | undefined | null) => {
      if (!text) return ''
      const key = blockI18nKey(text)
      return key && t.has(key) ? t(key) : text
    },
    [t]
  )
}
