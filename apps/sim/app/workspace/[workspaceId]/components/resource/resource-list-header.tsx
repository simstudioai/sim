'use client'

import type { ComponentProps } from 'react'
import { Resource } from '@/app/workspace/[workspaceId]/components/resource/resource'
import { useResourceDirectory } from '@/app/workspace/[workspaceId]/components/resource/resource-navigation'

/** Adds the project's directory crumb without replacing the list's folder navigation. */
export function ResourceListHeader(props: ComponentProps<typeof Resource.Header>) {
  const onDirectory = useResourceDirectory()
  if (!onDirectory) return <Resource.Header {...props} />
  const drop = props.breadcrumbDrop
  return (
    <Resource.Header
      {...props}
      title={undefined}
      breadcrumbs={[
        { label: 'Resources', onClick: onDirectory },
        ...(props.breadcrumbs ?? [{ label: props.title ?? '', icon: props.icon }]),
      ]}
      breadcrumbDrop={
        drop
          ? {
              ...drop,
              activeIndex: drop.activeIndex === null ? null : drop.activeIndex + 1,
              onDragOver: (event, folderId, index) => drop.onDragOver(event, folderId, index - 1),
              onDragLeave: (event, index) => drop.onDragLeave(event, index - 1),
            }
          : undefined
      }
    />
  )
}
