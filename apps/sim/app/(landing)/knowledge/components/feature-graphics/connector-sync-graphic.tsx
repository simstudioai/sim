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
import {
  FeatureGraphicShell,
  type FeatureGraphicVariant,
} from '@/app/(landing)/enterprise/components/feature-graphics'
import styles from '@/app/(landing)/knowledge/components/feature-graphics/connector-sync-graphic.module.css'

interface ConnectorSyncGraphicProps {
  variant?: FeatureGraphicVariant
}

interface ConnectorSource {
  icon: ComponentType<{ className?: string }>
  name: string
  documents: string
  syncing?: boolean
}

interface ConnectorCardProps {
  source: ConnectorSource
  portrait: boolean
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
function ConnectorCard({ source, portrait, index }: ConnectorCardProps) {
  return (
    <div className={cn('relative min-w-0', portrait ? 'h-full' : 'h-[68px]', CARD_STEPS[index])}>
      <div className='-bottom-1.5 absolute inset-x-3 top-3 rounded-[10px] border border-[var(--border-1)] bg-[var(--surface-3)] opacity-50' />
      <div className='-bottom-[3px] absolute inset-x-1.5 top-1.5 rounded-[10px] border border-[var(--border-1)] bg-[var(--surface-2)]' />
      <div
        className={cn(
          'relative flex h-full rounded-[10px] border border-[var(--border-1)] bg-[var(--white)] shadow-xs dark:bg-[var(--surface-4)]',
          portrait ? 'flex-col justify-between p-[3cqw]' : 'items-center gap-2.5 px-2.5'
        )}
      >
        <div className='flex shrink-0 items-center justify-between'>
          <source.icon
            className={cn('shrink-0', portrait ? 'size-[clamp(18px,6cqw,24px)]' : 'size-5')}
          />
          {portrait && (
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
          )}
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

/** Six lightly stacked source cards fill the portrait stage, with a compact grid for feature tiles. */
export function ConnectorSyncGraphic({ variant = 'tile' }: ConnectorSyncGraphicProps) {
  const portrait = variant === 'portrait'

  return (
    <FeatureGraphicShell variant={variant}>
      <div
        aria-hidden='true'
        data-feature-graphic='connectors'
        className={cn(
          'absolute inset-0 flex justify-center [container-type:inline-size]',
          portrait ? 'p-5' : 'items-center pr-8 max-lg:pr-6'
        )}
      >
        <div
          className={cn(
            'flex w-full flex-col',
            portrait
              ? 'h-full'
              : 'max-w-[312px] sm:max-lg:[@container(min-width:500px)]:max-w-[400px]'
          )}
        >
          <div className={cn('flex items-center justify-between', portrait ? 'mb-5' : 'mb-4')}>
            <span className='text-[var(--text-primary)] text-base'>Connectors</span>
            <ChipTag variant='mono'>Auto-sync</ChipTag>
          </div>
          <div
            className={cn(
              'grid grid-cols-2 gap-x-3 pb-1.5',
              portrait ? 'min-h-0 flex-1 grid-rows-3 gap-y-4' : 'gap-y-3'
            )}
          >
            {CONNECTOR_SOURCES.map((source, index) => (
              <ConnectorCard key={source.name} source={source} portrait={portrait} index={index} />
            ))}
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
