import type { ComponentType, SVGProps } from 'react'
import { Search } from '@/components/emcn'
import {
  GithubIcon,
  GmailIcon,
  GoogleDriveIcon,
  HubspotIcon,
  JiraIcon,
  LinearIcon,
  NotionIcon,
  PostgresIcon,
  SalesforceIcon,
  SlackIcon,
} from '@/components/icons'
import { CalloutFrame } from '@/app/(landing)/components/features/components/feature-stage/feature-stage'

/**
 * The Integrate beat's callout — a static recreation of Sim's integration
 * picker: a search over the 1,000+ connectors, each with its real brand mark
 * and category, the way you'd wire a tool into an agent. The lower rows dissolve
 * through the frame's foot fade, implying the rest of the catalog. Decorative.
 */
interface Integration {
  name: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  category: string
}

const INTEGRATIONS: Integration[] = [
  { name: 'Slack', Icon: SlackIcon, category: 'Messaging' },
  { name: 'Gmail', Icon: GmailIcon, category: 'Email' },
  { name: 'HubSpot', Icon: HubspotIcon, category: 'CRM' },
  { name: 'Salesforce', Icon: SalesforceIcon, category: 'CRM' },
  { name: 'Notion', Icon: NotionIcon, category: 'Docs' },
  { name: 'Jira', Icon: JiraIcon, category: 'Issues' },
  { name: 'GitHub', Icon: GithubIcon, category: 'Code' },
  { name: 'Linear', Icon: LinearIcon, category: 'Issues' },
  { name: 'Google Drive', Icon: GoogleDriveIcon, category: 'Storage' },
  { name: 'Postgres', Icon: PostgresIcon, category: 'Database' },
]

export function IntegrationsCallout() {
  return (
    <CalloutFrame className='w-[340px]' bodyClassName='h-[320px]' fade>
      <div className='flex h-full flex-col'>
        <div className='flex h-[40px] flex-shrink-0 items-center gap-2 border-[var(--border)] border-b px-4'>
          <Search className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
          <span className='text-[var(--text-muted)] text-sm'>Search 1,000+ integrations…</span>
        </div>
        <div className='flex flex-col px-2 pt-1.5'>
          {INTEGRATIONS.map(({ name, Icon, category }) => (
            <div key={name} className='flex items-center gap-2.5 rounded-md px-2 py-1.5'>
              <Icon className='size-[16px] flex-shrink-0' />
              <span className='flex-1 text-[var(--text-body)] text-sm'>{name}</span>
              <span className='text-[11px] text-[var(--text-muted)]'>{category}</span>
            </div>
          ))}
        </div>
      </div>
    </CalloutFrame>
  )
}
