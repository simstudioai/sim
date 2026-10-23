import { ChipTextarea, chipFieldSurfaceClass, chipGeometryClass, cn } from '@sim/emcn'
import { DEFAULT_TOOL_MODEL_IDS } from '@/app/(landing)/models/tools'

export const TEXT_ROWS = 10
export const TEXT_PLACEHOLDER = 'Paste a prompt, document, or conversation…'

const COUNT_FORMAT = new Intl.NumberFormat('en-US')

interface CharacterCountNoteProps {
  characters: number
}

/** The character count and privacy line under the text box, shared with the fallback. */
export function CharacterCountNote({ characters }: CharacterCountNoteProps) {
  return (
    <p className='text-[var(--text-muted)] text-caption'>
      {COUNT_FORMAT.format(characters)} characters. Text stays in your browser and is never sent to
      Sim.
    </p>
  )
}

/** The counter's closing note, shared by the island and its fallback so both wrap identically. */
export function TokenCounterFootnote() {
  return (
    <p className='border-[var(--border)] border-t px-6 py-4 text-[var(--text-muted)] text-caption leading-[150%]'>
      Exact counts use OpenAI&apos;s tiktoken encodings. Other providers do not publish a browser
      tokenizer, so their counts are character-based estimates. Input cost uses list prices and
      excludes the tokens a provider adds for message formatting.
    </p>
  )
}

/**
 * Static stand-in for {@link TokenCounter} while it renders on the client (its
 * `useQueryStates` reads the URL, so the statically generated page cannot
 * prerender it). Mirrors the island's text box, model picker, and one empty
 * table row per default model so the page does not shift when the island mounts.
 */
export function TokenCounterFallback() {
  return (
    <div aria-hidden className='flex flex-col'>
      <div className='flex flex-col gap-5 px-6 py-8'>
        <div className='flex flex-col gap-[9px]'>
          <span className='text-[var(--text-muted)] text-small'>Text</span>
          <ChipTextarea rows={TEXT_ROWS} readOnly tabIndex={-1} placeholder={TEXT_PLACEHOLDER} />
          <CharacterCountNote characters={0} />
        </div>

        <div className='flex flex-col gap-[9px]'>
          <span className='text-[var(--text-muted)] text-small'>Models</span>
          <div className='max-w-[640px]'>
            <div
              className={cn(
                'flex w-full max-md:pointer-coarse:min-h-11',
                chipGeometryClass,
                chipFieldSurfaceClass
              )}
            />
          </div>
        </div>
      </div>

      <div className='h-px w-full bg-[var(--border)]' />

      <div className='overflow-x-auto'>
        <table className='w-full min-w-[480px] border-collapse text-left'>
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
          <tbody>
            {DEFAULT_TOOL_MODEL_IDS.map((modelId) => (
              <tr key={modelId} className='border-[var(--border)] border-t align-top'>
                <th scope='row' className='px-6 py-4 font-normal'>
                  <span className='text-sm'>&nbsp;</span>
                  <p className='mt-0.5 text-caption leading-[150%]'>&nbsp;</p>
                </th>
                <td className='px-6 py-4 text-sm' />
                <td className='px-6 py-4 text-sm' />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TokenCounterFootnote />
    </div>
  )
}
