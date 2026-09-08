import { TerminalWindow } from '@sim/emcn/icons'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics/feature-graphic-shell'
import { FeaturePlatformPanel } from '@/app/(landing)/enterprise/components/feature-graphics/feature-platform-panel'

/** A terminal session showing Claude Code using the supported Sim CLI commands. */
export function CliGraphic() {
  return (
    <FeatureGraphicShell variant='portrait'>
      <div className='absolute inset-[10px]'>
        <FeaturePlatformPanel framed icon={TerminalWindow} title='Claude Code · Sim CLI'>
          <div className='min-w-0 p-5 text-caption leading-[1.5]'>
            <p className='mb-4 font-mono text-[var(--text-primary)]'>
              <span className='mr-2 text-[var(--text-muted)]'>$</span>
              sim login
            </p>
            <p className='rounded-md bg-[var(--surface-3)] px-3 py-2 text-[var(--text-body)]'>
              Run my support agent in Sim.
            </p>

            <div className='mt-5 space-y-4 font-mono'>
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

            <div className='mt-5 flex items-center gap-2 border-[var(--border)] border-t pt-4 text-[var(--text-secondary)]'>
              <span className='size-1.5 shrink-0 rounded-full bg-[var(--text-secondary)]' />
              <span>Run completed</span>
            </div>
          </div>
        </FeaturePlatformPanel>
      </div>
    </FeatureGraphicShell>
  )
}
