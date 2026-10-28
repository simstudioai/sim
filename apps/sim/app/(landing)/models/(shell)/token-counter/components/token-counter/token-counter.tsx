'use client'

import { useDeferredValue, useId, useMemo, useRef, useState } from 'react'
import { ChipTag, ChipTextarea } from '@sim/emcn'
import Link from 'next/link'
import { useQueryStates } from 'nuqs'
import { estimateTokenCount } from '@/lib/tokenization/estimators'
import {
  CharacterCountNote,
  TEXT_PLACEHOLDER,
  TEXT_ROWS,
  TokenCounterFootnote,
} from '@/app/(landing)/models/(shell)/token-counter/components/token-counter/token-counter-fallback'
import {
  tokenCounterParsers,
  tokenCounterUrlKeys,
} from '@/app/(landing)/models/(shell)/token-counter/search-params'
import { ModelMultiSelect } from '@/app/(landing)/models/components/model-multi-select'
import { formatUsd, resolveToolModels } from '@/app/(landing)/models/tools'
import { formatPrice } from '@/app/(landing)/models/utils'
import { priceTokenUsage } from '@/providers/pricing'

/** `js-tiktoken` and its ~2.5 MB of rank tables, loaded on first interaction. */
type AccurateTokenizer = typeof import('@/lib/tokenization/accurate')

/** Providers whose models tokenize with a public `js-tiktoken` encoding. */
const EXACT_TOKENIZER_PROVIDER_IDS = new Set(['openai'])

const COUNT_FORMAT = new Intl.NumberFormat('en-US')

/**
 * Counts tokens for pasted text entirely in the browser. OpenAI models get
 * exact counts from `@/lib/tokenization/accurate`, which is imported only when
 * the visitor first focuses or types in the text box so the tokenizer never
 * ships in the page's initial bundle; every other provider uses the heuristic
 * estimators and is labelled as an estimate.
 */
export function TokenCounter() {
  const fieldId = useId()
  const [{ models: modelIds }, setParams] = useQueryStates(tokenCounterParsers, tokenCounterUrlKeys)
  const [text, setText] = useState('')
  const [tokenizer, setTokenizer] = useState<AccurateTokenizer | null>(null)
  const tokenizerRequest = useRef<Promise<void> | null>(null)
  const deferredText = useDeferredValue(text)

  const loadTokenizer = () => {
    if (tokenizerRequest.current) return
    tokenizerRequest.current = import('@/lib/tokenization/accurate').then(setTokenizer, () => {
      tokenizerRequest.current = null
    })
  }

  const selectedModels = useMemo(() => resolveToolModels(modelIds), [modelIds])

  const rows = useMemo(() => {
    const exactCountByEncoding = new Map<string, number | null>()
    const countExact = (activeTokenizer: AccurateTokenizer, modelId: string) => {
      const encodingName = activeTokenizer.resolveEncodingName(modelId)
      if (!exactCountByEncoding.has(encodingName)) {
        exactCountByEncoding.set(
          encodingName,
          activeTokenizer.getExactTokenCount(deferredText, modelId)
        )
      }
      return exactCountByEncoding.get(encodingName) ?? null
    }

    return selectedModels.map((model) => {
      const exactTokens =
        tokenizer !== null && EXACT_TOKENIZER_PROVIDER_IDS.has(model.providerId)
          ? countExact(tokenizer, model.id)
          : null
      const exact = exactTokens !== null
      const tokens = exactTokens ?? estimateTokenCount(deferredText, model.providerId).count
      const inputCost = priceTokenUsage(model.pricing, { input: tokens, output: 0 }).total
      return { model, exact, tokens, inputCost }
    })
  }, [selectedModels, tokenizer, deferredText])

  return (
    <div className='flex flex-col'>
      <div className='flex flex-col gap-5 px-6 py-8'>
        <div className='flex flex-col gap-[9px]'>
          <label htmlFor={`${fieldId}-text`} className='text-[var(--text-muted)] text-small'>
            Text
          </label>
          <ChipTextarea
            id={`${fieldId}-text`}
            rows={TEXT_ROWS}
            resizable
            spellCheck={false}
            placeholder={TEXT_PLACEHOLDER}
            value={text}
            onFocus={loadTokenizer}
            onChange={(event) => {
              loadTokenizer()
              setText(event.target.value)
            }}
          />
          <CharacterCountNote characters={text.length} />
        </div>

        <div className='flex flex-col gap-[9px]'>
          <span id={`${fieldId}-models`} className='text-[var(--text-muted)] text-small'>
            Models
          </span>
          <div className='max-w-[640px]'>
            <ModelMultiSelect
              labelId={`${fieldId}-models`}
              value={selectedModels.map((model) => model.id)}
              onChange={(models) => setParams({ models })}
            />
          </div>
        </div>
      </div>

      <div className='h-px w-full bg-[var(--border)]' />

      {rows.length === 0 ? (
        <p className='px-6 py-10 text-[var(--text-muted)] text-sm'>
          Select one or more models to count tokens.
        </p>
      ) : (
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[480px] border-collapse text-left'>
            <caption className='sr-only'>Token count and input cost per model</caption>
            <thead>
              <tr className='text-[var(--text-muted)] text-caption uppercase tracking-[0.1em]'>
                <th scope='col' className='px-6 py-3 font-normal'>
                  Model
                </th>
                <th scope='col' className='px-6 py-3 text-right font-normal'>
                  Tokens
                </th>
                <th scope='col' className='px-6 py-3 text-right font-normal'>
                  Input cost
                </th>
              </tr>
            </thead>
            <tbody aria-live='polite'>
              {rows.map(({ model, exact, tokens, inputCost }) => (
                <tr key={model.id} className='border-[var(--border)] border-t align-top'>
                  <th scope='row' className='px-6 py-4 font-normal'>
                    <Link
                      href={model.href}
                      className='text-[var(--text-primary)] text-sm hover:underline hover:underline-offset-2'
                    >
                      {model.displayName}
                    </Link>
                    <p className='mt-0.5 text-[var(--text-muted)] text-caption leading-[150%]'>
                      {model.providerName} &middot; Input {formatPrice(model.pricing.input)}/1M
                    </p>
                  </th>
                  <td className='px-6 py-4 text-right'>
                    <span className='inline-flex items-center gap-2'>
                      <ChipTag variant='mono'>{exact ? 'exact' : 'estimate'}</ChipTag>
                      <span className='text-[var(--text-primary)] text-sm tabular-nums'>
                        {COUNT_FORMAT.format(tokens)}
                      </span>
                    </span>
                  </td>
                  <td className='px-6 py-4 text-right text-[var(--text-primary)] text-sm tabular-nums'>
                    {formatUsd(inputCost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TokenCounterFootnote />
    </div>
  )
}
