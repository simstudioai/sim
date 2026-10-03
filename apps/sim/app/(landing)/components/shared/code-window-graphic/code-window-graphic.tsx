import { cn } from '@sim/emcn'
import { TerminalWindow } from '@sim/emcn/icons'
import styles from '@/app/(landing)/components/shared/code-window-graphic/code-window-graphic.module.css'

/** The compact preview sequences up to six visual command rows. */
export type CodeWindowCommands =
  | readonly [string]
  | readonly [string, string]
  | readonly [string, string, string]
  | readonly [string, string, string, string]
  | readonly [string, string, string, string, string]
  | readonly [string, string, string, string, string, string]

interface CodeWindowGraphicProps {
  filename: string
  commands: CodeWindowCommands
}

/** A complete terminal window with sequentially typed, documentation-backed CLI examples. */
export function CodeWindowGraphic({ filename, commands }: CodeWindowGraphicProps) {
  return (
    <div className={styles.window}>
      <div className={styles.titlebar}>
        <div aria-hidden='true' className='flex items-center gap-1.5'>
          <span className={styles.windowDot} />
          <span className={styles.windowDot} />
          <span className={styles.windowDot} />
        </div>
        <span className='flex items-center gap-2 text-[var(--text-secondary)] text-caption'>
          <TerminalWindow className='size-[14px]' />
          Terminal
        </span>
        <span className='text-[var(--text-muted)] text-xs'>zsh</span>
      </div>
      <div className={styles.body}>
        <div className='mb-5 font-mono text-[var(--text-muted)] text-xs'>
          ~/sim/{filename.replace(/\.sh$/, '')}
        </div>
        <div className='sr-only'>
          <pre>{commands.join('\n')}</pre>
        </div>
        <div aria-hidden='true' className={styles.lines}>
          {commands.map((command, index) => {
            const continuation = index > 0 && commands[index - 1].trimEnd().endsWith('\\')
            return (
              <div
                key={`${index}-${command}`}
                className={cn(styles.row, !continuation && index > 0 && styles.commandGroup)}
              >
                <span className={cn(styles.prompt, continuation && styles.continuation)}>
                  {continuation ? '›' : '$'}
                </span>
                <code className={styles.typed}>{command.trimStart()}</code>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
