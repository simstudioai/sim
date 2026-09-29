'use client'

import type { ReactNode } from 'react'
import { Avatar, Chip, ChipTag } from '@sim/emcn'
import { Key, Plus } from '@sim/emcn/icons'
import { JiraIcon, LinearIcon, SlackMonoIcon } from '@/components/icons'
import { PEOPLE, type Workspace } from '@/app/playground/org/lib/mock-data'
import { SETTINGS_NAV } from '@/app/playground/org/lib/settings-nav'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'

interface ProjectSettingsProps {
  workspace: Workspace
  sectionId: string
}

/** One settings section; the settings list itself lives in the sidebar. */
export function ProjectSettings({ workspace, sectionId }: ProjectSettingsProps) {
  const active = SETTINGS_NAV.find((item) => item.id === sectionId)
  if (!active) throw new Error(`Unknown settings section ${sectionId}`)
  const ActiveIcon = active.icon
  return (
    <div className='h-full overflow-y-auto'>
      <div className='mx-auto flex max-w-[760px] flex-col gap-6 px-8 py-8'>
        <header className='flex items-start gap-3'>
          <ActiveIcon className='mt-1 size-[18px] shrink-0 text-[var(--text-icon)]' />
          <div className='flex min-w-0 flex-1 flex-col gap-1'>
            <h2 className='text-[20px] text-[var(--text-primary)] leading-tight'>{active.label}</h2>
            <p className='text-[var(--text-muted)] text-small'>{active.description}</p>
          </div>
          {PRIMARY_ACTION[active.id] && (
            <Chip variant='primary' leftIcon={Plus}>
              {PRIMARY_ACTION[active.id]}
            </Chip>
          )}
        </header>
        <SectionContent id={active.id} workspace={workspace} />
      </div>
    </div>
  )
}

const PRIMARY_ACTION: Record<string, string> = {
  teammates: 'Invite',
  secrets: 'Add secret',
  byok: 'Add key',
  sandboxes: 'Add package',
  'custom-tools': 'New tool',
  mcp: 'Add server',
  'workflow-mcp-servers': 'New server',
  'api-keys': 'Create key',
  'custom-blocks': 'Publish block',
}

function Rows({ children }: { children: ReactNode }) {
  return <div className='flex flex-col gap-2'>{children}</div>
}

function Muted({ children }: { children: ReactNode }) {
  return <span className='text-[var(--text-muted)] text-small'>{children}</span>
}

function SectionContent({ id, workspace }: { id: string; workspace: Workspace }) {
  switch (id) {
    case 'project':
      return <ProjectGeneral workspace={workspace} />
    case 'teammates':
      return (
        <Rows>
          {Object.values(PEOPLE).map((person, index) => (
            <SettingsResourceRow
              key={person.id}
              iconVariant='custom'
              icon={<Avatar size='md' name={person.name} />}
              title={person.name}
              description={`${person.id}@acme.com`}
              trailing={
                <ChipTag variant='gray'>
                  {index === 0 ? 'Admin' : index === 1 ? 'Write' : 'Read'}
                </ChipTag>
              }
            />
          ))}
        </Rows>
      )
    case 'secrets':
      return (
        <Rows>
          {['SLACK_BOT_TOKEN', 'LINEAR_API_KEY', 'ZENDESK_TOKEN', 'STRIPE_READ_KEY'].map((key) => (
            <SettingsResourceRow
              key={key}
              icon={<Key />}
              title={<span className='font-mono'>{key}</span>}
              description='••••••••••••'
              trailing={<Muted>Updated 3d ago</Muted>}
            />
          ))}
        </Rows>
      )
    case 'byok':
      return (
        <Rows>
          {[
            ['Anthropic', 'Connected · used by 6 workflows'],
            ['OpenAI', 'Connected · used by 2 workflows'],
            ['Google Gemini', 'Not set — hosted key in use'],
          ].map(([name, status]) => (
            <SettingsResourceRow key={name} icon={<Key />} title={name} description={status} />
          ))}
        </Rows>
      )
    case 'sandboxes':
      return (
        <Rows>
          {[
            ['pandas', 'Python · 2.2.3'],
            ['requests', 'Python · 2.32'],
            ['zod', 'npm · 3.23'],
          ].map(([name, version]) => (
            <SettingsResourceRow
              key={name}
              title={<span className='font-mono'>{name}</span>}
              description={version}
            />
          ))}
        </Rows>
      )
    case 'custom-tools':
      return (
        <Rows>
          {[
            ['lookup_account', 'Find an account by email in the CRM'],
            ['score_churn', 'Return a churn score for one account'],
          ].map(([name, desc]) => (
            <SettingsResourceRow
              key={name}
              title={<span className='font-mono'>{name}</span>}
              description={desc}
              navigable
            />
          ))}
        </Rows>
      )
    case 'mcp':
      return (
        <Rows>
          <SettingsResourceRow
            title='Linear'
            description='12 tools · connected'
            icon={<LinearIcon />}
            navigable
          />
          <SettingsResourceRow
            title='Slack'
            description='8 tools · connected'
            icon={<SlackMonoIcon />}
            navigable
          />
        </Rows>
      )
    case 'workflow-mcp-servers':
      return (
        <Rows>
          <SettingsResourceRow
            title={`${workspace.name} tools`}
            description='3 workflows exposed · https://mcp.sim.ai/acme/infra'
            navigable
          />
        </Rows>
      )
    case 'api-keys':
      return (
        <Rows>
          {['CI deploys', 'Zapier bridge'].map((name) => (
            <SettingsResourceRow
              key={name}
              icon={<Key />}
              title={name}
              description='sk-sim-••••••••4f2a'
              trailing={<Muted>Last used 2h ago</Muted>}
            />
          ))}
        </Rows>
      )
    case 'inbox':
      return (
        <Rows>
          <SettingsResourceRow
            title={`${workspace.id}@mail.sim.ai`}
            description='Incoming email triggers feedback-triage'
          />
        </Rows>
      )
    case 'recently-deleted':
      return (
        <Rows>
          {[
            ['old-support-bot', 'Workflow · deleted 4d ago'],
            ['alerts_backup', 'Table · deleted 12d ago'],
          ].map(([name, meta]) => (
            <SettingsResourceRow
              key={name}
              title={name}
              description={meta}
              trailing={<Chip>Restore</Chip>}
            />
          ))}
        </Rows>
      )
    case 'forks':
      return (
        <Rows>
          <SettingsResourceRow
            title={`${workspace.name} (staging)`}
            description='Fork · 3 changes ahead of parent'
            trailing={<Chip>Sync</Chip>}
          />
        </Rows>
      )
    case 'custom-blocks':
      return (
        <Rows>
          <SettingsResourceRow
            title='Churn score'
            description='Published from churn-agent v3 · used in 4 workflows'
            navigable
          />
        </Rows>
      )
    case 'requests':
      return <Muted>No open requests.</Muted>
    default:
      return <Muted>Nothing here yet.</Muted>
  }
}

function ProjectGeneral({ workspace }: { workspace: Workspace }) {
  const TrackerIcon =
    workspace.tracker.kind === 'jira'
      ? JiraIcon
      : workspace.tracker.kind === 'linear'
        ? LinearIcon
        : null
  const rows: [string, ReactNode][] = [
    ['Name', workspace.name],
    ['Description', workspace.description],
    [
      'Tracker',
      <span key='tracker' className='flex items-center gap-1.5'>
        {TrackerIcon && <TrackerIcon className='size-[14px]' />}
        {workspace.tracker.kind === 'sim'
          ? 'Sim tracker'
          : `${workspace.tracker.label} · two-way sync`}
      </span>,
    ],
    [
      'Feedback sources',
      workspace.feedbackSources.length
        ? workspace.feedbackSources.map((source) => source.label).join(', ')
        : 'None',
    ],
    ['Triage', 'Sim proposes issues from feedback; a person accepts them'],
    ['Reporter replies', 'Reply in the original thread when a change ships'],
    ['Changelog', 'Drafted by Sim, released by a person'],
  ]
  return (
    <div className='flex flex-col'>
      {rows.map(([label, value]) => (
        <div
          key={label}
          className='flex items-center gap-4 border-[var(--border)] border-b py-3.5 text-small last:border-b-0'
        >
          <span className='w-[160px] shrink-0 text-[var(--text-muted)]'>{label}</span>
          <span className='min-w-0 flex-1 text-[var(--text-body)]'>{value}</span>
          <Chip className='shrink-0'>Edit</Chip>
        </div>
      ))}
    </div>
  )
}
