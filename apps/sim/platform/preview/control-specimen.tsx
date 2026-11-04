import { Fragment, type ReactNode, useId } from 'react'
import type evidence from '@/platform/design-system/catalog/evidence.json'
import { glyphs, type IconName } from '@/platform/design-system/catalog/icon-geometry'
import {
  ActionMenu,
  Avatar,
  AvatarGroup,
  AvatarOverflow,
  Button,
  Chip,
  ComposerInput,
  DataTable,
  DestinationTabs,
  Disclosure,
  EmptyState,
  FieldFrame,
  IconButton,
  Input,
  LogoUploadField,
  MenuItem,
  MetricGroup,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  MultiStepModal,
  OverflowText,
  PeoplePopover,
  PersonRow,
  RangePicker,
  RecipientField,
  RecipientTag,
  ScrollArea,
  SearchableSelect,
  SearchField,
  SegmentedControl,
  Select,
  SelectField,
  SelectionItem,
  TextArea,
  TextAreaField,
  TextField,
  Tooltip,
  TouchTarget,
} from '@/platform/design-system/components'
import type { PreviewData } from '@/platform/fixtures'
import styles from '@/platform/preview/specimen.module.css'

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
  'Menu/Help/downloads-hover': ['Download apps', 'Contact support', 'Documentation', 'Changelog'],
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
              ? 'pill'
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
    case 'MetricGroup':
      return <MetricGroup metrics={data?.dashboard.metrics ?? []} />
    case 'DataTable':
      return (
        <DataTable
          title='Runs by agent'
          columns={[
            { key: 'agent', label: 'Agent', kind: 'text' },
            { key: 'requests', label: 'Requests', kind: 'number' },
            { key: 'resolved', label: 'Resolved', kind: 'number' },
            { key: 'duration', label: 'Duration', kind: 'duration' },
            { key: 'cost', label: 'Cost', kind: 'currency' },
          ]}
          rows={data?.dashboard.rows ?? []}
          control={<RangePicker label='Range' options={sample?.ranges ?? []} size='compact' />}
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
          size={key === 'C0522' ? 'touch' : family.includes('/xs/') ? 'compact' : 'small'}
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
          organization={organization ? (family.includes('/40/') ? 'large' : 'small') : undefined}
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
      return <Select label={label} options={options} defaultValue={value} />
    case 'TextArea':
      return (
        <TextArea
          label={label}
          density={key === 'C0350' || key === 'C0353' ? 'expanded' : 'regular'}
          defaultValue={sample?.notes}
        />
      )
    case 'TextField':
      return <TextField label={label} defaultValue={value} />
    case 'SelectField':
      return <SelectField label={label} options={options} defaultValue={value} />
    case 'TextAreaField':
      return <TextAreaField label={label} defaultValue={sample?.notes} />
    case 'SearchField':
      return (
        <SearchField
          label='Search'
          placeholder='Search'
          variant={family.includes('/menu') ? 'menu' : 'outlined'}
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
          label={label}
          options={data?.organization.members ?? []}
          defaultValue={people[0]?.name ?? ''}
          searchLabel='Search'
        />
      )
    case 'LogoUploadField':
      return <LogoUploadField label='Logo' optional />
    case 'RecipientTag':
      return (
        <RecipientTag
          address={sample?.recipients[0]?.address ?? 'Recipient'}
          selected={family.includes('selected')}
        />
      )
    case 'RecipientField':
      return (
        <RecipientField
          label='Recipients'
          recipients={sample?.recipients ?? []}
          placeholder='Add an email'
          error={
            sample?.recipients.some((r) => r.invalid) ? 'Enter a valid email address.' : undefined
          }
        />
      )
    case 'Disclosure': {
      if (family.startsWith('Chat/Show'))
        return (
          <Disclosure
            label='Show more'
            expandedLabel='Show less'
            variant='more'
            initiallyOpen={key === 'C0288'}
          >
            {sample?.notes}
          </Disclosure>
        )
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
    case 'ActionMenu': {
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
          size={key === 'C0845' || key === 'C0847' ? 'compact' : 'regular'}
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
      return (
        <ModalFooter>
          <Button variant='quiet'>Cancel</Button>
          <Button variant='primary'>Send feedback</Button>
        </ModalFooter>
      )
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
                  options={data?.organization.members ?? []}
                  defaultValue={people[0]?.name ?? ''}
                  searchLabel='Search groups'
                />
              ),
            },
            {
              content: <RecipientField label='Recipients' recipients={sample?.recipients ?? []} />,
            },
          ]}
        />
      )
    default:
      throw new Error(`No specimen adapter for ${master.owner}`)
  }
}
