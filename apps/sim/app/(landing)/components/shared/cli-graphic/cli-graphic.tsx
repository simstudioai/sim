import { cn } from '@sim/emcn'
import { ArrowUp, FolderCode, TerminalWindow } from '@sim/emcn/icons'
import styles from '@/app/(landing)/components/shared/cli-graphic/cli-graphic.module.css'
import type { CodeSegment } from '@/app/(landing)/components/shared/code-window-graphic/code-window-graphic'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics/feature-graphic-shell'
import { FeaturePlatformPanel } from '@/app/(landing)/enterprise/components/feature-graphics/feature-platform-panel'

const CODE_LINES: readonly (readonly CodeSegment[])[] = [
  [{ text: 'sim workflows list' }],
  [{ text: 'sim workflows run \\' }],
  [{ text: '  "$WORKFLOW_ID" --manual \\', tone: 'muted' }],
  [{ text: '  --input ', tone: 'muted' }, { text: '@ticket.json \\' }],
  [{ text: '  --follow', tone: 'muted' }],
  [{ text: 'sim logs list ' }, { text: '--limit 5', tone: 'muted' }],
]

/** The original editor-and-composer composition, with supported CLI commands in a shell script. */
export function CliGraphic() {
  return (
    <FeatureGraphicShell variant='portrait'>
      <div className='absolute inset-[10px]'>
        <FeaturePlatformPanel framed icon={FolderCode} title='support-agent.sh'>
          <div className='space-y-2 overflow-hidden p-5 font-mono text-caption leading-[1.7] max-sm:space-y-1 max-sm:p-4 max-sm:text-[11px] max-sm:leading-[1.5]'>
            {CODE_LINES.map((line, index) => (
              <div
                key={index}
                className={cn(
                  'flex gap-3 whitespace-pre',
                  styles.codeLine,
                  (index === 1 || index === 5) && 'sm:pt-4'
                )}
              >
                <span className='w-3 shrink-0 select-none text-right text-[var(--text-muted)]'>
                  {index + 1}
                </span>
                <code>
                  {line.map((segment, segmentIndex) => (
                    <span
                      key={segmentIndex}
                      className={
                        segment.tone === 'muted'
                          ? 'text-[var(--text-secondary)]'
                          : 'text-[var(--text-primary)]'
                      }
                    >
                      {segment.text}
                    </span>
                  ))}
                </code>
              </div>
            ))}
          </div>
        </FeaturePlatformPanel>
        <div
          aria-hidden='true'
          className={cn(
            'absolute right-4 bottom-4 left-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3 shadow-xs dark:bg-[var(--surface-4)]',
            styles.composer
          )}
        >
          <p className='px-1 text-[var(--text-primary)] text-caption leading-[1.5]'>
            Run my support agent in Sim.
          </p>
          <div className='mt-3 flex items-center gap-2 px-1 text-[var(--text-secondary)] text-caption'>
            <TerminalWindow className='size-[14px] text-[var(--text-icon)]' />
            <span>Claude Code · Sim CLI</span>
            <span className='ml-auto flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--text-primary)]'>
              <ArrowUp className='size-[14px] text-[var(--text-inverse)]' />
            </span>
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
