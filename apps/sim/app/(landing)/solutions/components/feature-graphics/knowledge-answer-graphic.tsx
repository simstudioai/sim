import { cn } from '@sim/emcn'
import { BookOpen } from '@sim/emcn/icons'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics'
import styles from '@/app/(landing)/solutions/components/feature-graphics/knowledge-answer-graphic.module.css'

/**
 * An internal help-desk agent answering from the team's own docs, told
 * as a frameless chat vignette (the audit and monitoring tiles'
 * composition — no window chrome): the employee's question sits
 * right-aligned as a chat bubble in the family's white card chrome
 * (`--white` fill, 1px `--border-1` hairline — the build tile's
 * `--surface-3` bubble would vanish against this tile's own
 * `--surface-3` fill), the agent's grounded answer reads back as plain
 * `--text-primary` prose, and the tile's highlight is the citation — a
 * white source card in the audit tile's exact chrome (`--white` fill,
 * 1px `--border-1` hairline, `rounded-xl`, `shadow-sm`) pairing a
 * `BookOpen` icon in the lifecycle header's outlined `size-6` icon box
 * with the knowledge-base document the answer came from.
 *
 * Motion (from `knowledge-answer-graphic.module.css`): the exchange
 * stamps in top to bottom one element after another — question, answer,
 * then source — the audit tile's one-shot settle, never re-played — and
 * the source card's icon box then carries the family's shared quiet 6s
 * ring pulse to mark the grounding as the point. Both are removed under
 * `prefers-reduced-motion`.
 *
 * The feature tile's visual slot bleeds `2rem` right (`1.5rem` under
 * `max-lg`) but not left, so this centered vignette adds matching right
 * padding to land on the tile's visible center instead of the bled
 * slot's center. The column is fluid (`w-full max-w-[312px]`) so it
 * never exceeds the compensated slot at narrow tile widths — the source
 * label truncates instead of clipping. On the wide spanned tile of the
 * two-column band (container ≥500px inside `sm`..`lg`) the column
 * relaxes to 400px so the exchange breathes into the wide slot.
 */
interface KnowledgeAnswerGraphicProps {
  /** The employee's question bubble. */
  question?: string
  /** The agent's grounded answer. */
  answer?: string
  /** Document name on the source card. */
  sourceLabel?: string
  /** Attribution line beneath the source name. */
  sourceDetail?: string
}

export function KnowledgeAnswerGraphic({
  question = 'How do I reset my SSO password?',
  answer = 'Head to id.acme.com, choose "Forgot password", and follow the email link — no ticket needed.',
  sourceLabel = 'IT handbook',
  sourceDetail = 'Answered from your docs',
}: KnowledgeAnswerGraphicProps = {}) {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className='absolute inset-0 flex items-center justify-center pr-8 max-lg:pr-6'
      >
        <div className='flex w-full max-w-[312px] flex-col gap-3 sm:max-lg:[@container(min-width:500px)]:max-w-[400px]'>
          <div
            className={cn(
              'max-w-[85%] self-end rounded-lg border border-[var(--border-1)] bg-[var(--white)] px-3 py-2 text-[var(--text-primary)] text-caption leading-[1.5]',
              styles.stepQuestion
            )}
          >
            {question}
          </div>

          <p
            className={cn(
              'text-[var(--text-primary)] text-caption leading-[1.6]',
              styles.stepAnswer
            )}
          >
            {answer}
          </p>

          <div
            className={cn(
              'flex items-center gap-2.5 rounded-xl border border-[var(--border-1)] bg-[var(--white)] px-3 py-2.5 shadow-sm',
              styles.stepSource
            )}
          >
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-md border border-[var(--border-1)]',
                styles.sourcePulse
              )}
            >
              <BookOpen className='size-[14px] text-[var(--text-icon)]' />
            </span>
            <span className='min-w-0 flex-1'>
              <span className='block truncate font-medium text-[var(--text-primary)] text-small'>
                {sourceLabel}
              </span>
              <span className='block truncate text-[var(--text-muted)] text-caption'>
                {sourceDetail}
              </span>
            </span>
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
