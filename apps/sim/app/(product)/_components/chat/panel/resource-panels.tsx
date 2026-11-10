'use client'

import { type ReactNode, useRef, useState } from 'react'
import { IconButton } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import Link from 'next/link'
import { OpenPanel } from '@/app/(product)/_components/chat/panel/chat-panel-trigger'
import { EmptyPanelHeader, PanelTabs } from '@/app/(product)/_components/chat/panel/panel-tabs'
import styles from '@/app/(product)/_components/chat/panel/panels.module.css'
import { ResourceContent } from '@/app/(product)/_components/chat/panel/resource-content'
import { referenceOptions } from '@/app/(product)/_components/composer/reference-options'
import { ResourceMenu } from '@/app/(product)/_components/composer/resource-menu'
import type { PanelResources } from '@/platform/lib/data/models/chat-panel'

interface ResourcePanelsProps {
  panel: PanelResources
  /** Whether the conversation offers its open control before any resource has arrived. */
  alwaysOpenable: boolean
  children: ReactNode
}

/**
 * The panel over a chat's real resources. Its tabs and selection belong to the chat hook; its
 * width belongs to the divider, which keeps a width per viewer and chat.
 */
export function ResourcePanels({ panel, alwaysOpenable, children }: ResourcePanelsProps) {
  const { resources, collapsed, onSelect, onRemove, onExpand, onCollapse, resize } = panel
  const [expanded, setExpanded] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  /** Set by a press inside the panel, so a tab chosen by pointer can be told from arrow keys. */
  const pointer = useRef(false)
  const { picker } = panel
  const add = (
    <ResourceMenu
      label='Add resource'
      items={referenceOptions({ references: picker.items })}
      onSelect={picker.onSelect}
      onOpenChange={(open) => {
        if (open) picker.onOpen()
      }}
      onSearchChange={picker.onSearchChange}
      selectWorkspaces={false}
    />
  )
  function hide() {
    onCollapse()
    requestAnimationFrame(() => trigger.current?.focus())
  }
  const currentResource = resources.find((resource) => resource.active) ?? resources[0]
  const current = currentResource?.id ?? ''
  const tabs = resources.map((resource) => ({
    id: resource.id,
    label: resource.title,
    content: (
      <ResourceContent
        resource={resource}
        visible={!collapsed && resource.id === current}
        selected={resource.id === current}
        desktopScopeId={panel.desktopScopeId}
      />
    ),
  }))
  return (
    <OpenPanel.Provider
      value={
        alwaysOpenable || resources.length
          ? (element) => {
              trigger.current = element
              onExpand()
            }
          : null
      }
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
          onPointerDownCapture={() => {
            pointer.current = true
            panel.onInteraction()
          }}
          onKeyDownCapture={() => {
            pointer.current = false
            panel.onInteraction()
          }}
        >
          {tabs.length ? (
            <PanelTabs
              tabs={tabs}
              current={current}
              expanded={expanded}
              onSelect={(id) => onSelect(id, pointer.current)}
              onRemove={onRemove}
              add={add}
              actions={
                currentResource?.href &&
                currentResource.workspaceId && (
                  <IconButton
                    icon='I037'
                    label={`Open ${currentResource.title}`}
                    tooltip
                    render={<Link href={currentResource.href} />}
                  />
                )
              }
              onExpand={() => setExpanded((value) => !value)}
              onHide={hide}
            />
          ) : (
            <>
              <EmptyPanelHeader onHide={hide} />
              <EmptyState
                title='Nothing open yet'
                description='Resources Sim works on open here.'
                action={add}
              />
            </>
          )}
        </aside>
      </div>
    </OpenPanel.Provider>
  )
}
