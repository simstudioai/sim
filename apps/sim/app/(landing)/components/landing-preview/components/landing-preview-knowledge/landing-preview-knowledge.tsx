import { Database } from '@/components/emcn/icons'
import {
  AirtableIcon,
  AsanaIcon,
  ConfluenceIcon,
  GoogleDocsIcon,
  GoogleDriveIcon,
  JiraIcon,
  SalesforceIcon,
  SlackIcon,
  ZendeskIcon,
} from '@/components/icons'
import type {
  PreviewColumn,
  PreviewRow,
} from '@/app/(landing)/components/landing-preview/components/landing-preview-resource/landing-preview-resource'
import { LandingPreviewResource } from '@/app/(landing)/components/landing-preview/components/landing-preview-resource/landing-preview-resource'

const DB_ICON = <Database className='h-[14px] w-[14px]' />

function connectorIcons(icons: React.ComponentType<{ className?: string }>[]) {
  return {
    content: (
      <div className='flex items-center gap-1'>
        {icons.map((Icon, i) => (
          <Icon key={i} className='h-3.5 w-3.5 flex-shrink-0' />
        ))}
      </div>
    ),
  }
}

const COLUMNS: PreviewColumn[] = [
  { id: 'name', header: 'Name' },
  { id: 'documents', header: 'Documents' },
  { id: 'tokens', header: 'Tokens' },
  { id: 'connectors', header: 'Connectors' },
  { id: 'created', header: 'Created' },
]

const ROWS: PreviewRow[] = [
  {
    id: '1',
    cells: {
      name: { icon: DB_ICON, label: 'Product Documentation' },
      documents: { label: '847' },
      tokens: { label: '1,284,392' },
      connectors: connectorIcons([AsanaIcon, GoogleDocsIcon]),
      created: { label: '2 days ago' },
    },
  },
  {
    id: '2',
    cells: {
      name: { icon: DB_ICON, label: 'Customer Support KB' },
      documents: { label: '234' },
      tokens: { label: '892,104' },
      connectors: connectorIcons([ZendeskIcon, SlackIcon]),
      created: { label: '1 week ago' },
    },
  },
  {
    id: '3',
    cells: {
      name: { icon: DB_ICON, label: 'Engineering Wiki' },
      documents: { label: '1,203' },
      tokens: { label: '2,847,293' },
      connectors: connectorIcons([ConfluenceIcon, JiraIcon]),
      created: { label: 'March 12th, 2026' },
    },
  },
  {
    id: '4',
    cells: {
      name: { icon: DB_ICON, label: 'Marketing Assets' },
      documents: { label: '189' },
      tokens: { label: '634,821' },
      connectors: connectorIcons([GoogleDriveIcon, AirtableIcon]),
      created: { label: 'March 5th, 2026' },
    },
  },
  {
    id: '5',
    cells: {
      name: { icon: DB_ICON, label: 'Sales Playbook' },
      documents: { label: '92' },
      tokens: { label: '418,570' },
      connectors: connectorIcons([SalesforceIcon]),
      created: { label: 'February 28th, 2026' },
    },
  },
]

export function LandingPreviewKnowledge() {
  return (
    <LandingPreviewResource
      icon={Database}
      title='Knowledge Base'
      createLabel='New base'
      searchPlaceholder='Search knowledge bases...'
      columns={COLUMNS}
      rows={ROWS}
    />
  )
}
