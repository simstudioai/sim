import { useState } from 'react'
import { Dashboard, Rss, ShieldCheck } from '@sim/emcn/icons'
import { noop } from '@sim/utils/helpers'
import { EmptyState } from '@/components/empty-state/empty-state'
import {
  ChangelogEmptyState,
  DashboardEmptyState,
  FilesEmptyState,
  KnowledgeEmptyState,
  LogsEmptyState,
  TablesEmptyState,
  TestsEmptyState,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state'
import { RESOURCE_LIST_CHROME } from '@/app/workspace/[workspaceId]/components/resource/list-chrome'
import { Resource } from '@/app/workspace/[workspaceId]/components/resource/resource'

const pages = {
  tables: {
    ...RESOURCE_LIST_CHROME.tables,
    records: [
      ['Customers', '8', '24', 'Nov 2', 'You', 'Nov 4'],
      ['Renewal pipeline', '6', '12', 'Oct 26', 'You', 'Nov 3'],
    ],
    empty: (
      <TablesEmptyState
        title='Tables'
        description='Create a table to store structured data your agents can read and write.'
      />
    ),
  },
  files: {
    ...RESOURCE_LIST_CHROME.files,
    records: [
      ['Onboarding brief.md', '12 KB', 'Markdown', 'Nov 2', 'You', 'Nov 4'],
      ['Accounts.csv', '36 KB', 'CSV', 'Oct 28', 'You', 'Nov 3'],
    ],
    empty: <FilesEmptyState title='Files' description='Upload files to use in this workspace.' />,
  },
  knowledge: {
    ...RESOURCE_LIST_CHROME.knowledge,
    records: [['Customer handbook', '12', '18,400', '1', 'Nov 2', 'You', 'Nov 4']],
    empty: (
      <KnowledgeEmptyState
        title='Knowledge bases'
        description='Upload documents to give your agents a memory they can search.'
      />
    ),
  },
  tests: {
    title: 'Tests',
    icon: ShieldCheck,
    columns: [],
    records: [],
    empty: <TestsEmptyState />,
  },
  logs: {
    ...RESOURCE_LIST_CHROME.logs,
    records: [
      ['Lead enrichment', 'Nov 4', 'Success', '$0.01', 'Manual', '2.3s'],
      ['Account review', 'Nov 3', 'Success', '$0.02', 'Schedule', '4.8s'],
    ],
    empty: <LogsEmptyState />,
  },
  dashboards: {
    title: 'Dashboard',
    icon: Dashboard,
    columns: [],
    records: [],
    empty: <DashboardEmptyState />,
  },
  changelog: {
    title: 'Changelog',
    icon: Rss,
    columns: [],
    records: [],
    empty: <ChangelogEmptyState />,
  },
}

interface ResourcePreviewProps {
  section: string
  scenario: string | null
}

export function ResourcePreview({ section, scenario }: ResourcePreviewProps) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ column: string; direction: 'asc' | 'desc' } | null>(null)
  const page = Object.entries(pages).find(([key]) => key === section)?.[1]
  if (!page) return <EmptyState title='Page not found' description='' />
  const columns = page.columns
  const records = scenario === 'empty' ? [] : page.records
  const filtered = records.filter((row) =>
    row.some((cell) => cell.toLowerCase().includes(search.trim().toLowerCase()))
  )
  const sortIndex = columns.findIndex((column) => column.id === sort?.column)
  if (sort && sortIndex >= 0)
    filtered.sort(
      (left, right) =>
        left[sortIndex].localeCompare(right[sortIndex], undefined, { numeric: true }) *
        (sort.direction === 'asc' ? 1 : -1)
    )
  const rows = filtered.map((record) => ({
    id: record[0],
    cells: Object.fromEntries(columns.map(({ id }, i) => [id, { label: record[i] }])),
  }))
  return (
    <Resource>
      <Resource.Header
        icon={page.icon}
        title={page.title}
        actions={
          'actions' in page
            ? page.actions.map((action) => ({ ...action, disabled: true, onSelect: noop }))
            : undefined
        }
      />
      {columns.length > 0 && (
        <Resource.Options
          search={{
            value: search,
            onChange: setSearch,
            placeholder: 'searchPlaceholder' in page ? page.searchPlaceholder : undefined,
          }}
          sort={{
            options: columns.map(({ id, header }) => ({ id, label: header })),
            active: sort,
            onSort: (column, direction) => setSort({ column, direction }),
            onClear: () => setSort(null),
          }}
        />
      )}
      {records.length ? (
        <Resource.Table
          columns={columns}
          rows={rows}
          emptyState={<EmptyState title='No results' description='Try another search.' />}
        />
      ) : (
        page.empty
      )}
    </Resource>
  )
}
