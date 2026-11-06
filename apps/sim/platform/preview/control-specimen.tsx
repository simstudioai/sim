import { Fragment, type ReactNode, useId } from 'react'
import { HelpMenu } from '@/platform/app/(shell)/_components/sidebar/help-menu'
import type evidence from '@/platform/design-system/catalog/evidence.json'
import { glyphs, type IconName } from '@/platform/design-system/catalog/icon-geometry'
import {
  ActionMenu,
  AttachmentGrid,
  Avatar,
  AvatarGroup,
  AvatarOverflow,
  BarChart,
  BrowserActionsMenu,
  Button,
  Chip,
  ComposerInput,
  DataTable,
  DestinationTabs,
  Disclosure,
  DonutChart,
  EmptyState,
  ExecutionSteps,
  FieldFrame,
  IconButton,
  Input,
  LogoUploadField,
  MenuItem,
  MenuSearchField,
  MetricGroup,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  MultiStepModal,
  OverflowText,
  PeoplePopover,
  PersonRow,
  PropertyList,
  RangePicker,
  RecentItems,
  RecipientField,
  RecipientTag,
  ScrollArea,
  SearchableSelect,
  SearchField,
  SegmentedControl,
  Select,
  SelectField,
  SelectionItem,
  SidebarWorkspaceItems,
  Switch,
  TextArea,
  TextAreaField,
  TextField,
  Tooltip,
  TouchTarget,
  TrendChart,
  VisibilityMenu,
  WorkspaceList,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
  SettingsSurface,
} from '@/platform/design-system/components/settings-section/settings-section'
import type { PreviewData } from '@/platform/fixtures'
import { HomeChartSpecimen } from '@/platform/preview/home-chart-specimen'
import styles from '@/platform/preview/specimen.module.css'
import { formatCalendarDate } from '@/platform/shared/time'

interface ControlSpecimenProps {
  master: (typeof evidence)[number]
  data: PreviewData | null
  location: { theme: 'light' | 'dark'; scenario: string; destination: number }
  renderChild: (key: string) => ReactNode
}

const menuChoices: Readonly<Record<string, string[]>> = {
  'Menu/Attach/flat': [
    'Upload files',
    'Upload folder',
    'Chats',
    'Dashboards',
    'Tables',
    'Files',
    'Knowledge bases',
    'Workflows',
    'Logs',
    'Browser',
    'Terminal',
  ],
  'Menu/ChartRange': ['Last 7 days', 'Last 30 days', 'Last 90 days'],
  'Menu/ChatActions': ['Rename', 'Archive'],
  'Menu/CollectionSort': ['Recent activity', 'Name (A–Z)', 'Name (Z–A)'],
  'Menu/CollectionSort/hover': ['Recent activity', 'Name (A–Z)', 'Name (Z–A)'],
  'Menu/HelpDownloads': ['Sim for macOS'],
  'Menu/More actions': ['Rename', 'Duplicate', 'Move to', 'Archive'],
  'Menu/Theme/dark-selected': ['Light', 'Dark', 'System'],
}

const ratings = [
  { label: 'Good response', value: 'good', icon: 'I017' },
  { label: 'Bad response', value: 'bad', icon: 'I008' },
] as const
const views = [
  { label: 'All', value: 'all' },
  { label: 'Unread', value: 'unread' },
]

function AgentFilter({ data }: { data: PreviewData | null }) {
  const agents = (data?.dashboard.rows ?? []).map((row) => String(row.values.agent))
  return <RangePicker label='Agents' options={['All agents', ...agents]} />
}

const requestFilter = (
  <RangePicker label='Requests' options={['All requests', 'Succeeded', 'Retried']} />
)

function FeedbackFields({ notes }: { notes?: string }) {
  const id = useId()
  return (
    <>
      <FieldFrame label='Response quality'>
        <SegmentedControl label='Response quality' options={ratings} defaultValue='bad' />
      </FieldFrame>
      <FieldFrame id={id} label='Details' optional>
        <TextArea id={id} label='Details' defaultValue={notes} density='expanded' />
      </FieldFrame>
    </>
  )
}

export function ControlSpecimen({ master, data, renderChild, location }: ControlSpecimenProps) {
  const id = useId()
  const { key, family } = master
  const label = family.split('/')[0]
  const value = data?.organization.workspaces[0]?.name ?? ''
  const sample = data?.samples
  const people = (data?.organization.members ?? []).map((name) => ({
    name,
    src: sample?.avatarSrc,
  }))
  const options = (data?.organization.workspaces ?? []).map((item) => ({
    value: item.name,
    label: item.name,
  }))
  const candidate = 'icon' in master ? master.icon : null
  const icon: IconName =
    typeof candidate === 'string' && Object.hasOwn(glyphs, candidate)
      ? (candidate as IconName)
      : 'I108'
  const refs = 'parts' in master && Array.isArray(master.parts) ? master.parts : []
  switch (master.owner) {
    case 'Switch':
      return <Switch label={label} defaultChecked={family === 'Switch/on'} />
    case 'SettingsRow':
      return (
        <SettingsRow
          label={value || label}
          description={sample?.captions[0]}
          field={family.endsWith('stacked')}
        >
          {family.endsWith('stacked') ? (
            <Select
              label='Theme'
              variant='quiet'
              options={[{ value: 'system', label: 'System' }]}
            />
          ) : (
            data?.organization.members[0] && <Avatar name={data.organization.members[0]} />
          )}
        </SettingsRow>
      )
    case 'SettingsSurface':
    case 'SettingsSection': {
      const rows = (data?.samples.labels ?? [])
        .slice(0, 3)
        .map((text, i) => (
          <SettingsRow key={text} label={text} description={data?.samples.captions[i]} />
        ))
      return master.owner === 'SettingsSurface' ? (
        <SettingsSurface>{rows}</SettingsSurface>
      ) : (
        <SettingsSection title={value || label}>{rows}</SettingsSection>
      )
    }
    case 'ExecutionSteps':
      return <ExecutionSteps title='Plan' steps={data?.collections.steps ?? []} />
    case 'HomeActivityChart':
    case 'ChartTooltip':
      return <HomeChartSpecimen recipe={key} data={data} />
    case 'WorkspaceList':
      return (
        <WorkspaceList
          label='Workspaces'
          target={family.endsWith('/touch') ? 'touch' : 'standard'}
          items={data?.organization.workspaces ?? []}
        />
      )
    case 'SidebarWorkspaceItems':
      return (
        <SidebarWorkspaceItems
          label='Sidebar workspaces'
          items={data?.organization.workspaces ?? []}
        />
      )
    case 'RecentItems':
      return (
        <RecentItems title='Recents' label='Recent items' items={data?.collections.recent ?? []} />
      )
    case 'AttachmentGrid':
      return (
        <AttachmentGrid
          label='Attachments'
          layout={key === 'C0212' ? 'list' : 'grid'}
          attachments={data?.collections.attachments ?? []}
        />
      )
    case 'PropertyList':
      return <PropertyList title='Properties' properties={data?.samples.properties ?? []} />

    case 'Button': {
      const provider = family.includes('/Connect-')
      const retry = family.startsWith('Chat/Retry')
      const back = family.startsWith('Sidebar/Back')
      const buttonLabel = provider
        ? `Connect ${family.split('/Connect-')[1].replaceAll('-', ' ')}`
        : retry
          ? 'Retry'
          : key === 'C0134'
            ? 'Undo'
            : back
              ? 'Back'
              : label
      return (
        <Button
          variant={
            retry
              ? 'muted'
              : family.includes('destructive')
                ? 'destructive'
                : family.includes('primary')
                  ? 'primary'
                  : family.includes('quiet') || back
                    ? 'quiet'
                    : 'secondary'
          }
          size={retry || back || key === 'C0134' ? 'compact' : 'regular'}
          icon={provider || retry || back ? icon : undefined}
        >
          {buttonLabel}
        </Button>
      )
    }
    case 'ComposerInput': {
      const compact = key === 'C0372' || key === 'C0375'
      return (
        <ComposerInput
          label='Message'
          placeholder={
            compact ? 'Ask a follow-up…' : 'Ask about your business, or give Sim something to do…'
          }
          defaultValue={sample?.notes}
          density={compact ? 'compact' : 'standard'}
        />
      )
    }
    case 'DestinationTabs': {
      const destinations = (data?.dashboard.destinations ?? ['Workspace']).map((name, index) => ({
        label: name,
        href:
          '?' +
          new URLSearchParams({
            recipe: key,
            theme: location.theme,
            state: location.scenario,
            destination: String(index),
          }).toString(),
      }))
      return (
        <DestinationTabs
          label='Workspace sections'
          destinations={destinations}
          currentHref={(destinations[location.destination] ?? destinations[0])?.href ?? ''}
        />
      )
    }
    case 'TrendChart':
      return (
        <TrendChart
          title='Workflow runs'
          maximum={data?.charts.maximum}
          points={
            data?.charts.trend.map(({ date, value }) => ({
              label: formatCalendarDate(date),
              value,
            })) ?? []
          }
          control={requestFilter}
        />
      )
    case 'BarChart':
      return (
        <BarChart
          title='Runs by day'
          maximum={data?.charts.maximum}
          series={['Succeeded', 'Retried']}
          bars={data?.charts.bars ?? []}
          control={requestFilter}
        />
      )
    case 'DonutChart':
      return (
        <DonutChart
          title='Runs by workflow'
          totalLabel='Total runs'
          segments={data?.charts.distribution ?? []}
          control={<AgentFilter data={data} />}
        />
      )
    case 'MetricGroup':
      return <MetricGroup metrics={data?.dashboard.metrics ?? []} />
    case 'DataTable':
      return (
        <DataTable
          title='Agent performance'
          columns={[
            { key: 'agent', label: 'Agent', kind: 'text' },
            { key: 'status', label: 'Live status', kind: 'status', showFrom: 'compact' },
            { key: 'requests', label: 'Requests', kind: 'number' },
            { key: 'resolved', label: 'Resolved', kind: 'percent', showFrom: 'wide' },
            { key: 'duration', label: 'Avg time', kind: 'duration', unit: 'minute' },
            { key: 'cost', label: 'Cost', kind: 'currency', currency: 'USD', showFrom: 'wide' },
          ]}
          rows={data?.dashboard.rows ?? []}
          control={<AgentFilter data={data} />}
        />
      )
    case 'Chip':
      return <Chip selected={family.includes('selected')}>{value || label}</Chip>
    case 'IconButton':
      return (
        <IconButton
          icon={icon}
          label={
            family.includes('/Send')
              ? 'Send message'
              : family.includes('JumpToLatest')
                ? 'Jump to latest'
                : label
          }
          variant={
            family.includes('/Send')
              ? 'solid'
              : family.includes('JumpToLatest')
                ? 'floating'
                : 'quiet'
          }
          disabled={family.includes('disabled')}
          size={family.includes('/xs/') ? 'compact' : 'small'}
        />
      )
    case 'TouchTarget':
      return (
        <TouchTarget>
          <>{refs[0] ? renderChild(refs[0]) : null}</>
        </TouchTarget>
      )
    case 'Avatar': {
      const organization = family.includes('organization')
      return (
        <Avatar
          name={(organization ? data?.organization.name : people[0]?.name) || label}
          organization={organization}
          src={family.includes('photo') ? sample?.avatarSrc : undefined}
        />
      )
    }
    case 'PeoplePopover':
      return <PeoplePopover title='People' people={people} />
    case 'PersonRow':
      return <PersonRow name={people[0]?.name ?? 'Person'} src={sample?.avatarSrc} />
    case 'AvatarGroup':
      return <AvatarGroup people={people} />
    case 'AvatarOverflow':
      return <AvatarOverflow people={people.slice(2)} />
    case 'Tooltip':
      return (
        <Tooltip label={value || 'Description'}>
          <IconButton label='Details' icon='I108' />
        </Tooltip>
      )
    case 'OverflowText':
      return <OverflowText text={value || label} />
    case 'Input':
      return <Input label={label} defaultValue={value} />
    case 'Select':
      return family.startsWith('Select/Theme') ? (
        <Select
          label='Theme'
          variant='quiet'
          options={['Light', 'Dark', 'System'].map((option) => ({ value: option, label: option }))}
          defaultValue={location.theme === 'dark' ? 'Dark' : 'System'}
        />
      ) : (
        <Select label={label} options={options} defaultValue={value} />
      )
    case 'TextArea':
      return (
        <TextArea
          label={label}
          density={key === 'C0350' || key === 'C0353' ? 'expanded' : undefined}
          defaultValue={sample?.notes}
        />
      )
    case 'TextField':
      return <TextField label={label} defaultValue={value} />
    case 'SelectField':
      return <SelectField label={label} options={options} defaultValue={value} />
    case 'TextAreaField':
      return <TextAreaField label={label} defaultValue={sample?.notes} />
    case 'MenuSearchField':
      return <MenuSearchField label='Search' />
    case 'SearchField':
      return (
        <SearchField
          label='Search'
          placeholder='Search'
          variant={family.startsWith('Sidebar/Search') ? 'sidebar' : 'outlined'}
          defaultValue={family.includes('query') ? value : undefined}
          shortcut={
            key === 'C0925'
              ? '⌘K'
              : family.startsWith('Sidebar/Search') && !family.includes('query')
                ? '/'
                : undefined
          }
        />
      )
    case 'SearchableSelect':
      return (
        <SearchableSelect
          label='Permission group'
          options={['None', ...(data?.organization.permissionGroups ?? [])]}
          defaultValue='None'
          searchLabel='Search permission groups…'
          createLabel='Create permission group…'
        />
      )
    case 'LogoUploadField':
      return <LogoUploadField label='Logo' optional />
    case 'RecipientTag':
      return <RecipientTag address={sample?.recipients[0]?.address ?? 'Recipient'} />
    case 'RecipientField':
      return (
        <RecipientField
          label='Recipients'
          defaultRecipients={sample?.recipients}
          placeholder='Add an email'
        />
      )
    case 'Disclosure': {
      if (family.startsWith('Chat/Show'))
        return <span>{key === 'C0288' ? 'Show less' : 'Show more'}</span>
      if (family.includes('ActivityDisclosure'))
        return (
          <Disclosure label='Activity' variant='activity'>
            {sample?.notes}
          </Disclosure>
        )
      return (
        <Disclosure
          label='Workspaces'
          variant='section'
          initiallyOpen={family.includes('expanded')}
        >
          {value}
        </Disclosure>
      )
    }
    case 'SelectionItem':
      return (
        <SelectionItem
          label={icon === 'I008' ? 'Bad response' : 'Good response'}
          icon={icon}
          value={icon}
          name={id}
          defaultChecked={family.includes('selected')}
        />
      )
    case 'SegmentedControl':
      return family.includes('ResponseQuality') ? (
        <SegmentedControl label='Response quality' options={ratings} defaultValue='bad' />
      ) : (
        <SegmentedControl label='View' options={views} defaultValue='all' />
      )
    case 'MenuItem':
      return (
        <MenuItem
          label={sample?.actions[0] ?? 'Action'}
          icon={candidate ? icon : undefined}
          selected={family.includes('selected') || undefined}
        />
      )
    case 'BrowserActionsMenu':
      return <BrowserActionsMenu />
    case 'VisibilityMenu':
      return (
        <VisibilityMenu
          label='Customize Home'
          options={[
            { id: 'tasks', label: 'Tasks run', visible: true },
            { id: 'email', label: 'Email', visible: true },
            { id: 'calendar', label: 'Calendar', visible: true },
          ]}
        />
      )
    case 'ActionMenu': {
      const download = menuChoices['Menu/HelpDownloads'][0]
      if (family === 'Menu/HelpDownloads')
        return (
          <ActionMenu label='Download apps'>
            <MenuItem label={download} icon='I041' trailingIcon='I030' />
          </ActionMenu>
        )
      if (family === 'Menu/Help/downloads-hover') return <HelpMenu />
      const options = menuChoices[family] ?? []
      const range = family.includes('ChartRange')
      const sort = family.includes('CollectionSort')
      const theme = family.includes('Theme')
      const choice = range || sort || theme
      const selected = theme ? 'Dark' : options[0]
      return (
        <ActionMenu
          label={theme ? 'Theme' : sort ? 'Sort' : range ? 'Range' : 'Actions'}
          defaultValue={choice ? selected : undefined}
        >
          {options.map((name, index) => (
            <MenuItem
              key={name}
              label={name}
              value={choice ? name : undefined}
              selected={choice ? name === selected : undefined}
              shortcut={name === 'Duplicate' ? '⌘D' : undefined}
              icon={!choice && refs[index] === 'C0697' ? 'I116' : undefined}
            />
          ))}
        </ActionMenu>
      )
    }
    case 'RangePicker':
      return (
        <RangePicker
          label='Range'
          options={sample?.ranges ?? ['Option one', 'Option two']}
          defaultValue={sample?.ranges.at(-1)}
        />
      )
    case 'ScrollArea':
      return (
        <div className={styles.viewport}>
          <ScrollArea label={family.startsWith('Sidebar') ? 'Sidebar' : 'Conversation'}>
            {refs.map((ref, index) => (
              <Fragment key={index}>{renderChild(ref)}</Fragment>
            ))}
          </ScrollArea>
        </div>
      )
    case 'EmptyState':
      return <EmptyState title={label} description={sample?.notes} />
    case 'ModalHeader':
      return <ModalHeader title='Share feedback' description='What could Sim have done better?' />
    case 'ModalBody':
      return (
        <ModalBody label='Feedback'>
          <FeedbackFields notes={sample?.notes} />
        </ModalBody>
      )
    case 'ModalFooter':
      return <ModalFooter confirmLabel='Send feedback' />
    case 'Modal': {
      if (family.includes('ResponseFeedback'))
        return (
          <Modal
            variant='feedback'
            triggerLabel='Open feedback'
            title='Share feedback'
            description='What could Sim have done better?'
            confirmLabel='Send feedback'
          >
            <FeedbackFields notes={sample?.notes} />
          </Modal>
        )
      if (family.includes('Disconnect'))
        return (
          <Modal
            variant='confirm'
            triggerLabel='Open confirmation'
            title={family.includes('Email') ? 'Disconnect email' : 'Disconnect calendar'}
            confirmLabel='Disconnect'
            destructive
          />
        )
      return (
        <Modal variant='form' triggerLabel='Open dialog' title='Workspace' confirmLabel='Save'>
          <TextField label='Name' defaultValue={value} />
        </Modal>
      )
    }
    case 'MultiStepModal':
      return (
        <MultiStepModal
          triggerLabel='Open steps'
          title='Create workspace'
          confirmLabel='Create'
          steps={[
            { content: <TextField label='Workspace name' defaultValue={value} /> },
            { content: <LogoUploadField label='Logo' optional /> },
            {
              content: (
                <SearchableSelect
                  label='Permission group'
                  options={['None', ...(data?.organization.permissionGroups ?? [])]}
                  defaultValue='None'
                  searchLabel='Search permission groups…'
                  createLabel='Create permission group…'
                />
              ),
            },
            {
              content: <RecipientField label='Recipients' defaultRecipients={sample?.recipients} />,
            },
          ]}
        />
      )
    default:
      throw new Error(`No specimen adapter for ${master.owner}`)
  }
}
