import { cn } from '@sim/emcn'
import { Check, ChevronDown, ChevronRight, Search } from '@sim/emcn/icons'
import { LANDING_STAGE_WINDOW_RADIUS } from '@/app/(landing)/components/landing-layout'
import { LogsRunGraph } from '@/app/(landing)/components/shared/logs-run-graph'
import {
  COMPLETED_RUNS,
  SUMMARY_STATS,
} from '@/app/(landing)/components/shared/logs-run-graph/constants'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics'
import styles from '@/app/(landing)/logs/components/feature-graphics/run-trace-graphic.module.css'

const RUNS = [
  { name: 'Support ticket routing', time: 'Just now', duration: '1.86s', trigger: 'API' },
  { name: 'Enrich inbound lead', time: '2 min ago', duration: '24.2s', trigger: 'Webhook' },
  { name: 'Sync knowledge base', time: '5 min ago', duration: '18.6s', trigger: 'Schedule' },
] as const

/** A compact Logs overview with sample recent runs and the selected run’s trace. */
export function RunTraceGraphic() {
  return (
    <FeatureGraphicShell variant='portrait'>
      <div className={cn(styles.window, LANDING_STAGE_WINDOW_RADIUS, 'shadow-xs')}>
        <div className={styles.toolbar}>
          <Search className='size-[14px] text-[var(--text-icon)]' />
          <span>Toolbar</span>
          <span>Editor</span>
          <span className={styles.activeTab}>Logs</span>
        </div>
        <div className={styles.overviewHeading}>
          <span>Run overview</span>
          <span className='flex items-center gap-1 text-[10px] text-[var(--text-muted)]'>
            Last 24 hours
            <ChevronDown className='size-3' />
          </span>
        </div>
        <div className={styles.overview}>
          <div className={styles.stats}>
            {SUMMARY_STATS.map((stat) => (
              <div key={stat.label} className={styles.stat}>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
            ))}
          </div>
          <LogsRunGraph layout='card' />
          <div className='flex justify-between text-[9px] text-[var(--text-muted)]'>
            <span>24 hours ago</span>
            <span>Now</span>
          </div>
        </div>
        <div className={styles.runsHeading}>
          <span>Recent runs</span>
          <span className='text-[var(--text-muted)]'>{COMPLETED_RUNS} runs</span>
        </div>
        <div className={styles.runs}>
          {RUNS.map((run, index) => (
            <div key={run.name} className={cn(styles.run, index === 0 && styles.selected)}>
              <Check className='size-[13px] text-[var(--text-secondary)]' />
              <div className='min-w-0'>
                <span className={styles.runName}>{run.name}</span>
                <span className={styles.runMeta}>
                  {run.time}
                  <span>·</span>
                  {run.trigger}
                </span>
              </div>
              <span className='font-mono text-[10px] text-[var(--text-secondary)] tabular-nums'>
                {run.duration}
              </span>
              <ChevronRight className='size-3 text-[var(--text-muted)]' />
            </div>
          ))}
        </div>
        <div className={styles.detail}>
          <div className={styles.detailTabs}>
            <span className='text-[var(--text-primary)]'>Trace</span>
            <span>Input</span>
            <span>Output</span>
            <span className='ml-auto flex items-center gap-1'>
              <Check className='size-3' />
              Succeeded
            </span>
          </div>
          <div className={styles.traceRow}>
            <span>Support agent</span>
            <span className={styles.track}>
              <span />
            </span>
            <span>1.24s</span>
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
