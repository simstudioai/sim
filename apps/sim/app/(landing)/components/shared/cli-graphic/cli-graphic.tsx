import { cn } from '@sim/emcn'
import { TerminalWindow } from '@sim/emcn/icons'
import {
  FeatureGraphicShell,
  type FeatureGraphicVariant,
} from '@/app/(landing)/enterprise/components/feature-graphics/feature-graphic-shell'
import { FeaturePlatformPanel } from '@/app/(landing)/enterprise/components/feature-graphics/feature-platform-panel'

interface CliGraphicProps {
  variant?: FeatureGraphicVariant
}

/** A terminal session showing Claude Code using the supported Sim CLI commands. */
export function CliGraphic({ variant = 'tile' }: CliGraphicProps) {
  const portrait = variant === 'portrait'

  return (
    <FeatureGraphicShell variant={variant}>
      <div className={cn('absolute', portrait ? 'inset-[10px]' : 'inset-0')}>
        <FeaturePlatformPanel
          framed={portrait}
          className={cn(!portrait && 'top-5')}
          icon={TerminalWindow}
          title='Claude Code · Sim CLI'
        >
          <div className={cn('min-w-0 text-caption leading-[1.5]', portrait ? 'p-5' : 'px-4 py-3')}>
            {portrait && (
              <p className='mb-4 font-mono text-[var(--text-primary)]'>
                <span className='mr-2 text-[var(--text-muted)]'>$</span>
                sim login
              </p>
            )}
            <p className='rounded-md bg-[var(--surface-3)] px-3 py-2 text-[var(--text-body)]'>
              Run my support agent in Sim.
            </p>

            <div className={cn('font-mono', portrait ? 'mt-5 space-y-4' : 'mt-3 space-y-2')}>
              <div className='flex gap-2'>
                <span className='text-[var(--text-muted)]'>›</span>
                <code className='min-w-0 text-[var(--text-primary)]'>sim workflows list</code>
              </div>
              <div className='flex gap-2'>
                <span className='text-[var(--text-muted)]'>›</span>
                <code className='min-w-0 text-[var(--text-primary)]'>
                  {'sim workflows run \\'}
                  <span className='block text-[var(--text-muted)]'>{'<workflowId> --manual'}</span>
                </code>
              </div>
            </div>

            <div
              className={cn(
                'flex items-center gap-2 text-[var(--text-secondary)]',
                portrait ? 'mt-5 border-[var(--border)] border-t pt-4' : 'mt-3'
              )}
            >
              <span className='size-1.5 shrink-0 rounded-full bg-[var(--text-secondary)]' />
              <span>Run completed</span>
            </div>
          </div>
        </FeaturePlatformPanel>
      </div>
    </FeatureGraphicShell>
  )
}
