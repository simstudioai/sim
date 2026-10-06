'use client'

import type { ComponentType } from 'react'
import { Avatar, AvatarFallback, ChipDropdown, type ChipDropdownOption } from '@sim/emcn'
import {
  Dashboard,
  Database,
  File as FileIcon,
  Link as LinkIcon,
  Table as TableIcon,
  Workflow,
} from '@sim/emcn/icons'
import { JiraIcon, LinearIcon } from '@/components/icons'
import type { IssueDetail, IssueRecord } from '@/lib/api/contracts/issues'
import {
  ISSUE_PRIORITIES,
  ISSUE_PRIORITY_LABELS,
  type IssuePriority,
  type IssueResourceType,
} from '@/lib/issues/types'
import { useAvailableResources } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/available-resources'
import type { MothershipResourceType } from '@/app/workspace/[workspaceId]/home/types'
import { PRIORITY_ICONS } from '@/app/workspace/[workspaceId]/issues/components/priority-icon'
import { useToggleIssueResource, useUpdateIssue } from '@/hooks/queries/issues'
import { useWorkspaceMembersQuery } from '@/hooks/queries/workspace'

const PRIORITY_OPTIONS = ISSUE_PRIORITIES.map((priority) => ({
  value: String(priority),
  label: ISSUE_PRIORITY_LABELS[priority],
  icon: PRIORITY_ICONS[priority],
}))

const UNASSIGNED = '__unassigned__'

/** Linkable families, in the resource menu's order, and their Chat resource types. */
const RESOURCE_FAMILIES: {
  type: IssueResourceType
  chatType: MothershipResourceType
  label: string
  icon: ComponentType<{ className?: string }>
}[] = [
  { type: 'dashboard', chatType: 'dashboard', label: 'Dashboards', icon: Dashboard },
  { type: 'table', chatType: 'table', label: 'Tables', icon: TableIcon },
  { type: 'file', chatType: 'file', label: 'Files', icon: FileIcon },
  { type: 'knowledge_base', chatType: 'knowledgebase', label: 'Knowledge bases', icon: Database },
  { type: 'workflow', chatType: 'workflow', label: 'Workflows', icon: Workflow },
]

interface IssuePropertiesProps {
  workspaceId: string
  detail: IssueDetail
  canEdit: boolean
}

/** Owner and priority, then what the issue is linked to: workspace resources and tickets. */
export function IssueProperties({ workspaceId, detail, canEdit }: IssuePropertiesProps) {
  const { issue } = detail
  return (
    <div className='-mx-2 flex flex-wrap items-center gap-1 text-small'>
      <OwnerProperty workspaceId={workspaceId} issue={issue} canEdit={canEdit} />
      <PriorityProperty workspaceId={workspaceId} issue={issue} canEdit={canEdit} />
      <LinkedResources workspaceId={workspaceId} detail={detail} canEdit={canEdit} />
      {detail.tickets.length > 0 && <LinkedTickets tickets={detail.tickets} />}
    </div>
  )
}

interface PropertyProps {
  workspaceId: string
  issue: IssueRecord
  canEdit: boolean
}

function OwnerProperty({ workspaceId, issue, canEdit }: PropertyProps) {
  const members = useWorkspaceMembersQuery(workspaceId)
  const updateIssue = useUpdateIssue()
  const options = [
    {
      value: UNASSIGNED,
      label: 'Unassigned',
      iconElement: (
        <Avatar size='xs' aria-hidden>
          <AvatarFallback />
        </Avatar>
      ),
    },
    ...(members.data ?? []).map((member) => ({
      value: member.userId,
      label: member.name,
      iconElement: <Avatar size='xs' name={member.name} src={member.image} aria-hidden />,
    })),
  ]
  return (
    <ChipDropdown
      variant='ghost'
      showSelectedIcon
      value={issue.owner?.id ?? UNASSIGNED}
      options={options}
      disabled={!canEdit || updateIssue.isPending}
      onChange={(value) =>
        updateIssue.mutate({
          workspaceId,
          key: issue.key,
          ownerId: value === UNASSIGNED ? null : value,
        })
      }
      aria-label='Owner'
    />
  )
}

function PriorityProperty({ workspaceId, issue, canEdit }: PropertyProps) {
  const updateIssue = useUpdateIssue()
  return (
    <ChipDropdown
      variant='ghost'
      showSelectedIcon
      value={String(issue.priority)}
      options={PRIORITY_OPTIONS}
      disabled={!canEdit || updateIssue.isPending}
      onChange={(value) =>
        updateIssue.mutate({
          workspaceId,
          key: issue.key,
          priority: Number(value) as IssuePriority,
        })
      }
      aria-label='Priority'
    />
  )
}

interface LinkedResourcesProps {
  workspaceId: string
  detail: IssueDetail
  canEdit: boolean
}

/** The resources the issue is about: a searchable multi-select over the workspace's resources. */
function LinkedResources({ workspaceId, detail, canEdit }: LinkedResourcesProps) {
  const { groups } = useAvailableResources(workspaceId)
  const toggle = useToggleIssueResource()
  const linked = detail.resources.map((resource) => `${resource.type}:${resource.id}`)
  const linkedSet = new Set(linked)

  const options: ChipDropdownOption[] = []
  for (const family of RESOURCE_FAMILIES) {
    const items = groups.find((group) => group.type === family.chatType)?.items ?? []
    const known = new Set(items.map((item) => item.id))
    for (const resource of detail.resources) {
      if (resource.type === family.type && !known.has(resource.id))
        options.push({
          value: `${family.type}:${resource.id}`,
          label: resource.id,
          icon: family.icon,
        })
    }
    for (const item of items)
      options.push({ value: `${family.type}:${item.id}`, label: item.name, icon: family.icon })
  }
  options.sort((a, b) => Number(linkedSet.has(b.value)) - Number(linkedSet.has(a.value)))

  return (
    <ChipDropdown
      multiple
      searchable
      showAllOption={false}
      variant='ghost'
      leftIcon={LinkIcon}
      allLabel='Link'
      selectedLabel={(count) => `${count} linked`}
      searchPlaceholder='Search resources'
      options={options}
      value={linked}
      matchTriggerWidth={false}
      contentClassName='w-[320px]'
      disabled={!canEdit || toggle.isPending}
      onChange={(next) => {
        const nextSet = new Set(next)
        const added = next.find((value) => !linkedSet.has(value))
        const removed = linked.find((value) => !nextSet.has(value))
        const changed = added ?? removed
        if (!changed) return
        const separator = changed.indexOf(':')
        toggle.mutate({
          workspaceId,
          key: detail.issue.key,
          type: changed.slice(0, separator) as IssueResourceType,
          resourceId: changed.slice(separator + 1),
          unlink: Boolean(removed && !added),
        })
      }}
      aria-label='Linked resources'
    />
  )
}

/** Tickets in Linear or Jira; picking one opens it. */
interface LinkedTicketsProps {
  tickets: IssueDetail['tickets']
}

function LinkedTickets({ tickets }: LinkedTicketsProps) {
  return (
    <ChipDropdown
      variant='ghost'
      leftIcon={tickets[0]?.provider === 'jira' ? JiraIcon : LinearIcon}
      placeholder={tickets.length === 1 ? '1 ticket' : `${tickets.length} tickets`}
      options={tickets.map((ticket) => ({
        value: ticket.url,
        label: [ticket.externalKey, ticket.title, ticket.status].filter(Boolean).join(' · '),
        icon: ticket.provider === 'jira' ? JiraIcon : LinearIcon,
      }))}
      showSelectedCheck={false}
      matchTriggerWidth={false}
      onChange={(url) => window.open(url, '_blank', 'noopener')}
      aria-label='Linked tickets'
    />
  )
}
