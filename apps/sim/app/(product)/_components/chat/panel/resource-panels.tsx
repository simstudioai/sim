'use client'

import { type ReactNode, useRef, useState } from 'react'
import { EmptyState } from '@sim/emcn/empty-state'
import { OpenPanel } from '@/app/(product)/_components/chat/panel/chat-panels'
import type { PanelResources } from '@/app/(product)/_components/chat/panel/model'
import { PanelTabs } from '@/app/(product)/_components/chat/panel/panel-tabs'
import styles from '@/app/(product)/_components/chat/panel/panels.module.css'
import { ResourceContent } from '@/app/(product)/_components/chat/panel/resource-content'

interface ResourcePanelsProps {
  panel: PanelResources
  children: ReactNode
}

/**
 * The panel over a chat's real resources. Its tabs and selection belong to the chat hook; its
 * width belongs to the divider, which keeps a width per viewer and chat.
 */
export function ResourcePanels({ panel, children }: ResourcePanelsProps) {
  const { resources, collapsed, onSelect, onRemove, onExpand, onCollapse, resize } = panel
  const [expanded, setExpanded] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const current = resources.find((resource) => resource.active)?.id ?? resources[0]?.id ?? ''
  const tabs = resources.map((resource) => ({
    id: resource.id,
    label: resource.title,
    content: (
      <ResourceContent
        resource={resource}
        visible={!collapsed && resource.id === current}
        browserScopeId={panel.browserScopeId}
      />
    ),
  }))
  return (
    <OpenPanel.Provider
      value={(element) => {
        trigger.current = element
        onExpand()
      }}
    >
      <div
        className={styles.frame}
        data-panel-open={!collapsed}
        data-expanded={!collapsed && expanded}
      >
        <div className={styles.conversation}>{children}</div>
        <div
          className={styles.divider}
          role='separator'
          tabIndex={0}
          aria-orientation='vertical'
          aria-label='Resize resource view'
          hidden={collapsed || expanded}
          onPointerDown={resize.onPointerDown}
          onKeyDown={resize.onKeyDown}
          onFocus={resize.onFocus}
        />
        <aside
          ref={resize.panelRef}
          className={styles.panel}
          aria-label='Chat panel'
          hidden={collapsed}
          data-mothership-panel=''
          onPointerDownCapture={panel.onInteraction}
          onKeyDownCapture={panel.onInteraction}
        >
          {tabs.length ? (
            <PanelTabs
              tabs={tabs}
              current={current}
              expanded={expanded}
              onSelect={onSelect}
              onRemove={onRemove}
              onExpand={() => setExpanded((value) => !value)}
              onHide={() => {
                onCollapse()
                requestAnimationFrame(() => trigger.current?.focus())
              }}
            />
          ) : (
            <EmptyState title='Nothing open yet' description='Resources Sim works on open here.' />
          )}
        </aside>
      </div>
    </OpenPanel.Provider>
  )
}
