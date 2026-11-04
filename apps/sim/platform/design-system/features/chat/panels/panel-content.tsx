'use client'

import {
  Icon,
  IconButton,
  RecentItems,
  ScrollArea,
  WorkspaceList,
} from '@/platform/design-system/components'
import { usePlatformTheme } from '@/platform/design-system/components/product-surface'
import { useCompactViewport } from '@/platform/design-system/components/use-compact-viewport'
import { BrowserContent } from '@/platform/design-system/features/chat/panels/browser-content'
import type { PanelDestination } from '@/platform/design-system/features/chat/panels/chat-panels'
import styles from '@/platform/design-system/features/chat/panels/panels.module.css'
import type { PanelData, PanelRecent } from '@/platform/design-system/models/panel'

interface PanelContentProps {
  view: PanelDestination
  resource?: PanelRecent
  desktop: boolean
  data: PanelData | null
  recents: PanelRecent[]
  workspaces: readonly { id: string; name: string }[]
  onVisit: (view: PanelDestination) => void
  onHome: () => void
  onRecent: (item: PanelRecent) => void
  onRemove: (id: string) => void
}

export function PanelContent({
  view,
  resource,
  desktop,
  data,
  recents,
  workspaces,
  onVisit,
  onHome,
  onRecent,
  onRemove,
}: PanelContentProps) {
  const theme = usePlatformTheme()
  const compact = useCompactViewport('navigation')
  if (view === 'terminal')
    return (
      <div className={styles.document}>
        <ScrollArea label='Terminal history' startAtEnd>
          <pre className={styles.transcript} data-type='T014'>
            {data?.terminal ?? '$'}
          </pre>
        </ScrollArea>
      </div>
    )
  if (view === 'file' && data)
    return (
      <div className={styles.document}>
        <ScrollArea label='File contents'>
          <article className={styles.article}>
            <div>
              <h2 data-type='T074'>{data.file.title}</h2>
              <p data-type='T052'>{data.file.updated}</p>
            </div>
            <dl>
              {data.file.properties.map((field) => (
                <div key={field.label}>
                  <dt data-type='T052'>{field.label}</dt>
                  <dd data-type='T048'>{field.value}</dd>
                </div>
              ))}
            </dl>
            {data.file.sections.map((section) => (
              <section key={section.title}>
                <h3 data-type='T047'>{section.title}</h3>
                <p data-type='T048'>{section.text}</p>
              </section>
            ))}
          </article>
        </ScrollArea>
      </div>
    )
  const contents = (
    <div className={styles.start}>
      {!!recents.length && (
        <RecentItems
          label='Recents'
          items={recents}
          onSelect={(id) => {
            const item = recents.find((row) => row.id === id)
            if (item) onRecent(item)
          }}
          onRemove={onRemove}
        />
      )}
      <div className={styles.center}>
        {view === 'workspaces' ? (
          <div className={styles.workspaceList}>
            {desktop && (
              <IconButton label='Back to launcher' icon='I093' onClick={() => onVisit('start')} />
            )}
            <WorkspaceList
              target={compact ? 'touch' : 'standard'}
              label='Workspaces'
              items={workspaces}
              onSelect={onHome}
              theme={theme}
            />
          </div>
        ) : (
          <div className={styles.launcher}>
            <button type='button' onClick={() => onVisit('terminal')}>
              <Icon name='I107' />
              <span>
                <strong data-type='T043'>Terminal</strong>
                <small data-type='T067'>Run commands in this session</small>
              </span>
            </button>
            <button type='button' onClick={() => onVisit('workspaces')}>
              <Icon name='I025' />
              <span>
                <strong data-type='T043'>Workspaces</strong>
                <small data-type='T067'>Open a workspace</small>
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
  if (desktop || view === 'website')
    return (
      <BrowserContent
        key={resource?.id ?? 'launcher'}
        showTools={desktop && view !== 'workspaces'}
        website={data?.website}
        initialAddress={resource?.address}
      >
        {contents}
      </BrowserContent>
    )
  return contents
}
