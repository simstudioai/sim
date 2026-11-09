'use client'

import { ActivityRow } from '@sim/emcn/activity-row'
import { IconButton } from '@sim/emcn/button'
import { Icon } from '@sim/emcn/icon'
import { useCompactViewport } from '@sim/emcn/layout/use-compact-viewport'
import { ScrollArea } from '@sim/emcn/scroll-area'
import { RecentItems } from '@sim/emcn-platform/recent-items'
import { WorkspaceList } from '@sim/emcn-platform/workspace-list'
import { BrowserContent } from '@/app/(product)/_components/chat/panel/browser-content'
import type { PanelDestination } from '@/app/(product)/_components/chat/panel/chat-panels'
import type { PanelData, PanelRecent } from '@/app/(product)/_components/chat/panel/model'
import styles from '@/app/(product)/_components/chat/panel/panels.module.css'
import { formatRelativeTime } from '@/platform/shared/time'

interface PanelContentProps {
  view: PanelDestination
  resource?: PanelRecent
  desktop: boolean
  data: PanelData | null
  recents: PanelRecent[]
  workspaces: readonly { id: string; name: string }[]
  onVisit: (view: PanelDestination) => void
  onWorkspace: (id: string) => void
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
  onWorkspace,
  onRecent,
  onRemove,
}: PanelContentProps) {
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
              <p data-type='T052'>Updated {formatRelativeTime(data.file.updatedAt, data.asOf)}</p>
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
              onSelect={onWorkspace}
            />
          </div>
        ) : (
          <ul className={styles.launcher} aria-label='Panel destinations'>
            <ActivityRow
              leading={<Icon name='I107' />}
              title='Terminal'
              detail='Run commands in this session'
              showChevron={false}
              onOpen={() => onVisit('terminal')}
            />
            <ActivityRow
              title='Workspaces'
              detail='Open a workspace'
              showChevron={false}
              onOpen={() => onVisit('workspaces')}
            />
          </ul>
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
