import type { ComponentType } from 'react'
import { ChipTag, cn } from '@sim/emcn'
import { Check } from '@sim/emcn/icons'
import {
  ConfluenceIcon,
  GithubIcon,
  GoogleDriveIcon,
  MicrosoftSharepointIcon,
  NotionIcon,
  SlackIcon,
} from '@/components/icons'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics'
import styles from '@/app/(landing)/knowledge/components/feature-graphics/connector-sync-graphic.module.css'

interface ConnectorSource {
  icon: ComponentType<{ className?: string }>
  name: string
  documents: string
  syncing?: boolean
}

interface ConnectorCardProps {
  source: ConnectorSource
  index: number
}

/** Supported knowledge sources, shown with illustrative document counts. */
const CONNECTOR_SOURCES: readonly ConnectorSource[] = [
  { icon: NotionIcon, name: 'Notion', documents: '128 docs', syncing: true },
  { icon: GoogleDriveIcon, name: 'Google Drive', documents: '342 docs' },
  { icon: ConfluenceIcon, name: 'Confluence', documents: '96 docs' },
  { icon: SlackIcon, name: 'Slack', documents: '24 channels' },
  { icon: GithubIcon, name: 'GitHub', documents: '86 files' },
  { icon: MicrosoftSharepointIcon, name: 'SharePoint', documents: '214 docs' },
]

const CARD_STEPS = [
  styles.card0,
  styles.card1,
  styles.card2,
  styles.card3,
  styles.card4,
  styles.card5,
]

/** Small document layers give each connected source depth without extra UI chrome. */
function ConnectorCard({ source, index }: ConnectorCardProps) {
  return (
    <div className={cn('relative h-full min-w-0', CARD_STEPS[index])}>
      <div className='-bottom-1.5 absolute inset-x-3 top-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface-3)] opacity-50' />
      <div className='-bottom-[3px] absolute inset-x-1.5 top-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)]' />
      <div className='relative flex h-full flex-col justify-between rounded-[10px] border border-[var(--border)] bg-[var(--white)] p-[3cqw] shadow-xs dark:bg-[var(--surface-4)]'>
        <div className='flex shrink-0 items-center justify-between'>
          <source.icon className='size-[clamp(18px,6cqw,24px)] shrink-0' />
          <span className='flex items-center gap-1 text-[11px] text-[var(--text-muted)] leading-4'>
            {source.syncing ? (
              <>
                <span className='size-1 animate-pulse rounded-full bg-[var(--text-icon)] motion-reduce:animate-none' />
                Syncing
              </>
            ) : (
              <Check className='size-3 text-[var(--text-icon)]' />
            )}
          </span>
        </div>
        <div className='min-w-0'>
          <p className='truncate text-[13px] text-[var(--text-primary)] leading-[18px]'>
            {source.name}
          </p>
          <p className='truncate text-[12px] text-[var(--text-muted)] leading-4'>
            {source.documents}
          </p>
        </div>
      </div>
    </div>
  )
}

/** Six lightly stacked source cards fill the portrait stage. */
export function ConnectorSyncGraphic() {
  return (
    <FeatureGraphicShell variant='portrait'>
      <div
        aria-hidden='true'
        data-feature-graphic='connectors'
        className='absolute inset-0 flex justify-center p-5 [container-type:inline-size]'
      >
        <div className='flex h-full w-full flex-col'>
          <div className='mb-5 flex items-center justify-between'>
            <span className='text-[var(--text-primary)] text-base'>Connectors</span>
            <ChipTag variant='mono'>Auto-sync</ChipTag>
          </div>
          <div className='grid min-h-0 flex-1 grid-cols-2 grid-rows-3 gap-x-3 gap-y-4 pb-1.5'>
            {CONNECTOR_SOURCES.map((source, index) => (
              <ConnectorCard key={source.name} source={source} index={index} />
            ))}
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
