'use client'

import { useState, useSyncExternalStore } from 'react'
import { ArrowLeft, Folder, Moon, Sun } from 'lucide-react'
import { notFound, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  BubbleChatClose,
  BubbleChatPreview,
  Button,
  ButtonGroup,
  ButtonGroupItem,
  Card as CardIcon,
  Checkbox,
  ChevronDown,
  ChipDatePicker,
  Code,
  Combobox,
  Connections,
  Cursor,
  DocumentAttachment,
  Download,
  Duplicate,
  Expand,
  Eye,
  FolderCode,
  FolderPlus,
  Hand,
  HexSimple,
  Input,
  Key as KeyIcon,
  Label,
  Layout,
  Library,
  Loader,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTabs,
  ModalTabsContent,
  ModalTabsList,
  ModalTabsTrigger,
  ModalTrigger,
  MoreHorizontal,
  NoWrap,
  PanelLeft,
  Play,
  PlayOutline,
  Popover,
  PopoverBackButton,
  PopoverContent,
  PopoverFolder,
  PopoverItem,
  PopoverScrollArea,
  PopoverSearch,
  PopoverSection,
  PopoverTrigger,
  Redo,
  Rocket,
  Slider,
  Switch,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TagInput,
  type TagItem,
  Textarea,
  TimePicker,
  ToastProvider,
  Tooltip,
  Trash,
  Trash2,
  toast,
  Undo,
  Wrap,
  ZoomIn,
  ZoomOut,
} from '@/components/emcn'
import { env, isTruthy } from '@/lib/core/config/env'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className='space-y-4'>
      <h2 className='border-[var(--border)] border-b pb-2 font-medium text-[var(--text-primary)] text-lg'>
        {title}
      </h2>
      <div className='space-y-4'>{children}</div>
    </section>
  )
}

function VariantRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex items-center gap-4'>
      <span className='w-32 shrink-0 text-[var(--text-secondary)] text-sm'>{label}</span>
      <div className='flex flex-wrap items-center gap-2'>{children}</div>
    </div>
  )
}

const SAMPLE_CODE = `function greet(name) {
  console.log("Hello, " + name);
  return { success: true };
}`

const SAMPLE_PYTHON = `def greet(name):
    print(f"Hello, {name}")
    return {"success": True}`

const COMBOBOX_OPTIONS = [
  { label: 'Option 1', value: 'opt1' },
  { label: 'Option 2', value: 'opt2' },
  { label: 'Option 3', value: 'opt3' },
]

const DARK_MODE_EVENT = 'playground:dark-mode-change'

const subscribeToDarkMode = (onStoreChange: () => void) => {
  window.addEventListener(DARK_MODE_EVENT, onStoreChange)
  return () => window.removeEventListener(DARK_MODE_EVENT, onStoreChange)
}

const getDarkModeSnapshot = () => document.documentElement.classList.contains('dark')
const getServerDarkModeSnapshot = () => false

export default function PlaygroundPage() {
  const t = useTranslations('auto')
  const router = useRouter()
  const [comboboxValue, setComboboxValue] = useState('')
  const [switchValue, setSwitchValue] = useState(false)
  const [checkboxValue, setCheckboxValue] = useState(false)
  const [sliderValue, setSliderValue] = useState([50])
  const [timeValue, setTimeValue] = useState('09:30')
  const isDarkMode = useSyncExternalStore(
    subscribeToDarkMode,
    getDarkModeSnapshot,
    getServerDarkModeSnapshot
  )
  const [buttonGroupValue, setButtonGroupValue] = useState('curl')
  const [dateValue, setDateValue] = useState('')
  const [dateRangeStart, setDateRangeStart] = useState('')
  const [dateRangeEnd, setDateRangeEnd] = useState('')
  const [tagItems, setTagItems] = useState<TagItem[]>([
    { value: 'user@example.com', isValid: true },
    { value: 'invalid-email', isValid: false, error: 'Invalid email format' },
  ])

  const toggleDarkMode = () => {
    document.documentElement.classList.toggle('dark')
    window.dispatchEvent(new Event(DARK_MODE_EVENT))
  }

  if (!isTruthy(env.NEXT_PUBLIC_ENABLE_PLAYGROUND)) {
    notFound()
  }

  return (
    <ToastProvider>
      <Tooltip.Provider>
        <div className='relative min-h-screen bg-[var(--bg)] p-8'>
          <div className='absolute top-8 left-8 flex items-center gap-2'>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button variant='ghost' onClick={() => router.back()} className='size-8 p-0'>
                  <ArrowLeft className='size-4' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>{t('go_back')}</Tooltip.Content>
            </Tooltip.Root>
          </div>
          <div className='absolute top-8 right-8'>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button variant='default' onClick={toggleDarkMode} className='size-8 p-0'>
                  {isDarkMode ? <Sun className='size-4' /> : <Moon className='size-4' />}
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>{isDarkMode ? 'Light mode' : 'Dark mode'}</Tooltip.Content>
            </Tooltip.Root>
          </div>
          <div className='mx-auto max-w-4xl space-y-12'>
            <div>
              <h1 className='font-semibold text-2xl text-[var(--text-primary)]'>
                {t('emcn_component_playground')}
              </h1>
              <p className='mt-2 text-[var(--text-secondary)]'>
                {t('all_emcn_ui_components_and_their')}
              </p>
            </div>

            {/* Toast */}
            <Section title={t('toast')}>
              <VariantRow label={t('default')}>
                <Button variant='default' onClick={() => toast({ message: 'Workflow saved' })}>
                  {t('show')}
                </Button>
              </VariantRow>
              <VariantRow label={t('info')}>
                <Button variant='default' onClick={() => toast.info('Sync in progress')}>
                  {t('show')}
                </Button>
              </VariantRow>
              <VariantRow label={t('success')}>
                <Button variant='default' onClick={() => toast.success('Imported 1,240 rows')}>
                  {t('show')}
                </Button>
              </VariantRow>
              <VariantRow label={t('warning')}>
                <Button
                  variant='default'
                  onClick={() =>
                    toast.warning('Usage nearing limit', {
                      description: '$4.20 used of $5.00 limit.',
                    })
                  }
                >
                  {t('show')}
                </Button>
              </VariantRow>
              <VariantRow label={t('error')}>
                <Button
                  variant='default'
                  onClick={() =>
                    toast.error('Jira 1: Read Issue failed', {
                      description: 'Domain and account are required.',
                    })
                  }
                >
                  {t('show')}
                </Button>
              </VariantRow>
              <VariantRow label={t('error_action')}>
                <Button
                  variant='default'
                  onClick={() =>
                    toast.error('Workflow Validation', {
                      description:
                        'Usage limit exceeded: $0.00 used of $5.00 limit. Please upgrade your plan to continue running this workflow.',
                      action: { label: 'Fix in Chat', onClick: () => {} },
                    })
                  }
                >
                  {t('show')}
                </Button>
              </VariantRow>
              <VariantRow label={t('success_action')}>
                <Button
                  variant='default'
                  onClick={() =>
                    toast.success('Deployed v3', {
                      action: { label: 'View deployment', onClick: () => {} },
                    })
                  }
                >
                  {t('show')}
                </Button>
              </VariantRow>
              <VariantRow label={t('stacking')}>
                <Button
                  variant='default'
                  onClick={() => {
                    toast.info('First notification')
                    toast.warning('Second notification')
                    toast.error('Third notification')
                  }}
                >
                  {t('show_3')}
                </Button>
                <Button variant='ghost' onClick={() => toast.dismissAll()}>
                  {t('dismiss_all')}
                </Button>
              </VariantRow>
            </Section>

            {/* Button */}
            <Section title={t('button')}>
              <VariantRow label={t('default')}>
                <Button variant='default'>{t('default_2')}</Button>
              </VariantRow>
              <VariantRow label={t('active')}>
                <Button variant='active'>{t('active_2')}</Button>
              </VariantRow>
              <VariantRow label={t('3d')}>
                <Button variant='3d'>3D</Button>
              </VariantRow>
              <VariantRow label={t('outline')}>
                <Button variant='outline'>{t('outline_2')}</Button>
              </VariantRow>
              <VariantRow label={t('primary')}>
                <Button variant='primary'>{t('primary_2')}</Button>
              </VariantRow>
              <VariantRow label={t('destructive')}>
                <Button variant='destructive'>{t('destructive_2')}</Button>
              </VariantRow>
              <VariantRow label={t('secondary')}>
                <Button variant='secondary'>{t('secondary_2')}</Button>
              </VariantRow>
              <VariantRow label={t('tertiary')}>
                <Button variant='tertiary'>{t('tertiary_2')}</Button>
              </VariantRow>
              <VariantRow label={t('ghost')}>
                <Button variant='ghost'>{t('ghost_2')}</Button>
              </VariantRow>
              <VariantRow label={t('ghost_secondary')}>
                <Button variant='ghost-secondary'>{t('ghost_secondary_2')}</Button>
              </VariantRow>
              <VariantRow label={t('disabled')}>
                <Button disabled>{t('disabled_2')}</Button>
              </VariantRow>
              <VariantRow label={t('size_sm')}>
                <Button size='sm'>{t('small')}</Button>
                <Button size='sm' variant='primary'>
                  {t('small_primary')}
                </Button>
              </VariantRow>
              <VariantRow label={t('size_md')}>
                <Button size='md'>{t('medium')}</Button>
                <Button size='md' variant='primary'>
                  {t('medium_primary')}
                </Button>
              </VariantRow>
            </Section>

            {/* ButtonGroup */}
            <Section title={t('buttongroup')}>
              <VariantRow label={t('default')}>
                <ButtonGroup value={buttonGroupValue} onValueChange={setButtonGroupValue}>
                  <ButtonGroupItem value='curl'>{t('curl')}</ButtonGroupItem>
                  <ButtonGroupItem value='python'>{t('python')}</ButtonGroupItem>
                  <ButtonGroupItem value='javascript'>{t('javascript')}</ButtonGroupItem>
                </ButtonGroup>
              </VariantRow>
              <VariantRow label={t('gap_none')}>
                <ButtonGroup value='opt1' gap='none'>
                  <ButtonGroupItem value='opt1'>{t('option_1')}</ButtonGroupItem>
                  <ButtonGroupItem value='opt2'>{t('option_2')}</ButtonGroupItem>
                </ButtonGroup>
              </VariantRow>
              <VariantRow label={t('gap_sm')}>
                <ButtonGroup value='opt1' gap='sm'>
                  <ButtonGroupItem value='opt1'>{t('option_1')}</ButtonGroupItem>
                  <ButtonGroupItem value='opt2'>{t('option_2')}</ButtonGroupItem>
                </ButtonGroup>
              </VariantRow>
              <VariantRow label={t('disabled')}>
                <ButtonGroup value='opt1' disabled>
                  <ButtonGroupItem value='opt1'>{t('option_1')}</ButtonGroupItem>
                  <ButtonGroupItem value='opt2'>{t('option_2')}</ButtonGroupItem>
                </ButtonGroup>
              </VariantRow>
              <VariantRow label={t('single_item')}>
                <ButtonGroup value='only'>
                  <ButtonGroupItem value='only'>{t('only_option')}</ButtonGroupItem>
                </ButtonGroup>
              </VariantRow>
            </Section>

            {/* Badge */}
            <Section title={t('badge')}>
              <VariantRow label={t('default')}>
                <Badge variant='default'>{t('default_2')}</Badge>
              </VariantRow>
              <VariantRow label={t('outline')}>
                <Badge variant='outline'>{t('outline_2')}</Badge>
              </VariantRow>
              <VariantRow label={t('type')}>
                <Badge variant='type'>{t('type_2')}</Badge>
              </VariantRow>
              <VariantRow label={t('green')}>
                <Badge variant='green'>{t('green_2')}</Badge>
                <Badge variant='green' dot>
                  {t('with_dot')}
                </Badge>
              </VariantRow>
              <VariantRow label={t('red')}>
                <Badge variant='red'>{t('red_2')}</Badge>
                <Badge variant='red' dot>
                  {t('with_dot')}
                </Badge>
              </VariantRow>
              <VariantRow label={t('blue')}>
                <Badge variant='blue'>{t('blue_2')}</Badge>
                <Badge variant='blue' dot>
                  {t('with_dot')}
                </Badge>
              </VariantRow>
              <VariantRow label={t('blue_secondary')}>
                <Badge variant='blue-secondary'>{t('blue_secondary_2')}</Badge>
              </VariantRow>
              <VariantRow label={t('purple')}>
                <Badge variant='purple'>{t('purple_2')}</Badge>
              </VariantRow>
              <VariantRow label={t('orange')}>
                <Badge variant='orange'>{t('orange_2')}</Badge>
              </VariantRow>
              <VariantRow label={t('amber')}>
                <Badge variant='amber'>{t('amber_2')}</Badge>
              </VariantRow>
              <VariantRow label={t('teal')}>
                <Badge variant='teal'>{t('teal_2')}</Badge>
              </VariantRow>
              <VariantRow label={t('cyan')}>
                <Badge variant='cyan'>{t('cyan_2')}</Badge>
              </VariantRow>
              <VariantRow label={t('gray')}>
                <Badge variant='gray'>{t('gray_2')}</Badge>
              </VariantRow>
              <VariantRow label={t('gray_secondary')}>
                <Badge variant='gray-secondary'>{t('gray_secondary_2')}</Badge>
              </VariantRow>
              <VariantRow label={t('sizes')}>
                <Badge size='sm'>{t('small')}</Badge>
                <Badge size='md'>{t('medium')}</Badge>
                <Badge size='lg'>{t('large')}</Badge>
              </VariantRow>
            </Section>

            {/* Input */}
            <Section title={t('input')}>
              <VariantRow label={t('default')}>
                <Input placeholder={t('enter_text')} className='max-w-xs' />
              </VariantRow>
              <VariantRow label={t('disabled')}>
                <Input placeholder={t('disabled_2')} disabled className='max-w-xs' />
              </VariantRow>
            </Section>

            {/* TagInput */}
            <Section title={t('taginput')}>
              <VariantRow label={t('default')}>
                <div className='w-80'>
                  <TagInput
                    items={tagItems}
                    onAdd={(value) => {
                      const isValid = value.includes('@') && value.includes('.')
                      setTagItems((prev) => [...prev, { value, isValid }])
                      return isValid
                    }}
                    onRemove={(_, index) => {
                      setTagItems((prev) => prev.filter((_, i) => i !== index))
                    }}
                    placeholder={t('enter_emails')}
                    placeholderWithTags='Add another'
                  />
                </div>
              </VariantRow>
              <VariantRow label={t('secondary_variant')}>
                <div className='w-80'>
                  <TagInput
                    items={[
                      { value: 'workflow', isValid: true },
                      { value: 'automation', isValid: true },
                    ]}
                    onAdd={() => true}
                    onRemove={() => {}}
                    placeholder={t('add_tags')}
                    placeholderWithTags='Add another'
                    triggerKeys={['Enter', ',']}
                  />
                </div>
              </VariantRow>
              <VariantRow label={t('disabled')}>
                <div className='w-80'>
                  <TagInput
                    items={[{ value: 'disabled@email.com', isValid: true }]}
                    onAdd={() => false}
                    onRemove={() => {}}
                    placeholder={t('disabled_input')}
                    disabled
                  />
                </div>
              </VariantRow>
            </Section>

            {/* Textarea */}
            <Section title={t('textarea')}>
              <Textarea placeholder={t('enter_your_message')} className='max-w-md' rows={4} />
            </Section>

            {/* Label */}
            <Section title={t('label')}>
              <div className='flex flex-col gap-2'>
                <Label htmlFor='demo-input'>{t('label_text')}</Label>
                <Input id='demo-input' placeholder={t('input_with_label')} className='max-w-xs' />
              </div>
            </Section>

            {/* Switch */}
            <Section title={t('switch')}>
              <VariantRow label={t('default')}>
                <Switch checked={switchValue} onCheckedChange={setSwitchValue} />
                <span className='text-[var(--text-secondary)] text-sm'>
                  {switchValue ? 'On' : 'Off'}
                </span>
              </VariantRow>
            </Section>

            {/* Checkbox */}
            <Section title={t('checkbox')}>
              <VariantRow label={t('default')}>
                <Checkbox checked={checkboxValue} onCheckedChange={(c) => setCheckboxValue(!!c)} />
                <span className='text-[var(--text-secondary)] text-sm'>
                  {checkboxValue ? 'Checked' : 'Unchecked'}
                </span>
              </VariantRow>
              <VariantRow label={t('size_sm')}>
                <Checkbox size='sm' />
                <span className='text-[var(--text-secondary)] text-sm'>{t('small_14px')}</span>
              </VariantRow>
              <VariantRow label={t('size_md')}>
                <Checkbox size='md' />
                <span className='text-[var(--text-secondary)] text-sm'>{t('medium_16px')}</span>
              </VariantRow>
              <VariantRow label={t('size_lg')}>
                <Checkbox size='lg' />
                <span className='text-[var(--text-secondary)] text-sm'>{t('large_20px')}</span>
              </VariantRow>
              <VariantRow label={t('disabled')}>
                <Checkbox disabled />
                <Checkbox disabled checked />
              </VariantRow>
            </Section>

            {/* Slider */}
            <Section title={t('slider')}>
              <VariantRow label={t('default')}>
                <div className='w-48'>
                  <Slider value={sliderValue} onValueChange={setSliderValue} max={100} step={1} />
                </div>
                <span className='text-[var(--text-secondary)] text-sm'>{sliderValue[0]}</span>
              </VariantRow>
              <VariantRow label={t('disabled')}>
                <div className='w-48'>
                  <Slider value={[30]} disabled max={100} step={1} />
                </div>
              </VariantRow>
            </Section>

            {/* Avatar */}
            <Section title={t('avatar')}>
              <VariantRow label={t('sizes')}>
                <Avatar size='xs'>
                  <AvatarFallback>XS</AvatarFallback>
                </Avatar>
                <Avatar size='sm'>
                  <AvatarFallback>SM</AvatarFallback>
                </Avatar>
                <Avatar size='md'>
                  <AvatarFallback>MD</AvatarFallback>
                </Avatar>
                <Avatar size='lg'>
                  <AvatarFallback>LG</AvatarFallback>
                </Avatar>
              </VariantRow>
              <VariantRow label={t('with_image')}>
                <Avatar size='md'>
                  <AvatarImage src='https://github.com/shadcn.png' alt={t('user')} />
                  <AvatarFallback>CN</AvatarFallback>
                </Avatar>
              </VariantRow>
              <VariantRow label={t('status_online')}>
                <Avatar size='md' status='online'>
                  <AvatarFallback>JD</AvatarFallback>
                </Avatar>
              </VariantRow>
              <VariantRow label={t('status_offline')}>
                <Avatar size='md' status='offline'>
                  <AvatarFallback>JD</AvatarFallback>
                </Avatar>
              </VariantRow>
              <VariantRow label={t('status_busy')}>
                <Avatar size='md' status='busy'>
                  <AvatarFallback>JD</AvatarFallback>
                </Avatar>
              </VariantRow>
              <VariantRow label={t('status_away')}>
                <Avatar size='md' status='away'>
                  <AvatarFallback>JD</AvatarFallback>
                </Avatar>
              </VariantRow>
              <VariantRow label={t('all_sizes_with_status')}>
                <Avatar size='xs' status='online'>
                  <AvatarFallback>XS</AvatarFallback>
                </Avatar>
                <Avatar size='sm' status='online'>
                  <AvatarFallback>SM</AvatarFallback>
                </Avatar>
                <Avatar size='md' status='online'>
                  <AvatarFallback>MD</AvatarFallback>
                </Avatar>
                <Avatar size='lg' status='online'>
                  <AvatarFallback>LG</AvatarFallback>
                </Avatar>
              </VariantRow>
            </Section>

            {/* Table */}
            <Section title={t('table')}>
              <VariantRow label={t('default')}>
                <Table className='max-w-md'>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('name')}</TableHead>
                      <TableHead>{t('status')}</TableHead>
                      <TableHead>{t('role')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className='hover:bg-[var(--surface-2)]'>
                      <TableCell>{t('alice')}</TableCell>
                      <TableCell>{t('active_2')}</TableCell>
                      <TableCell>{t('admin')}</TableCell>
                    </TableRow>
                    <TableRow className='hover:bg-[var(--surface-2)]'>
                      <TableCell>{t('bob')}</TableCell>
                      <TableCell>{t('pending')}</TableCell>
                      <TableCell>{t('user')}</TableCell>
                    </TableRow>
                    <TableRow className='hover:bg-[var(--surface-2)]'>
                      <TableCell>{t('charlie')}</TableCell>
                      <TableCell>{t('active_2')}</TableCell>
                      <TableCell>{t('user')}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </VariantRow>
              <VariantRow label={t('with_footer')}>
                <Table className='max-w-md'>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('item')}</TableHead>
                      <TableHead className='text-right'>{t('price')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>{t('product_a')}</TableCell>
                      <TableCell className='text-right'>$10.00</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>{t('product_b')}</TableCell>
                      <TableCell className='text-right'>$20.00</TableCell>
                    </TableRow>
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell>{t('total')}</TableCell>
                      <TableCell className='text-right'>$30.00</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </VariantRow>
              <VariantRow label={t('with_caption')}>
                <Table className='max-w-md'>
                  <TableCaption>{t('a_list_of_team_members')}</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('name')}</TableHead>
                      <TableHead>{t('department')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>{t('alice')}</TableCell>
                      <TableCell>{t('engineering')}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>{t('bob')}</TableCell>
                      <TableCell>{t('design')}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </VariantRow>
            </Section>

            {/* Combobox */}
            <Section title={t('combobox')}>
              <VariantRow label={t('default')}>
                <div className='w-48'>
                  <Combobox
                    options={COMBOBOX_OPTIONS}
                    value={comboboxValue}
                    onChange={setComboboxValue}
                    placeholder={t('select_option')}
                  />
                </div>
              </VariantRow>
              <VariantRow label={t('size_sm')}>
                <div className='w-48'>
                  <Combobox
                    options={COMBOBOX_OPTIONS}
                    value=''
                    onChange={() => {}}
                    placeholder={t('small_size')}
                    size='sm'
                  />
                </div>
              </VariantRow>
              <VariantRow label={t('searchable')}>
                <div className='w-48'>
                  <Combobox
                    options={COMBOBOX_OPTIONS}
                    value=''
                    onChange={() => {}}
                    placeholder={t('with_search')}
                    searchable
                  />
                </div>
              </VariantRow>
              <VariantRow label={t('editable')}>
                <div className='w-48'>
                  <Combobox
                    options={COMBOBOX_OPTIONS}
                    value=''
                    onChange={() => {}}
                    placeholder={t('type_or_select')}
                    editable
                  />
                </div>
              </VariantRow>
              <VariantRow label={t('multiselect')}>
                <div className='w-48'>
                  <Combobox
                    options={COMBOBOX_OPTIONS}
                    multiSelectValues={[]}
                    onMultiSelectChange={() => {}}
                    placeholder={t('select_multiple')}
                    multiSelect
                    searchable
                  />
                </div>
              </VariantRow>
            </Section>

            {/* TimePicker */}
            <Section title={t('timepicker')}>
              <VariantRow label={t('default')}>
                <div className='w-48'>
                  <TimePicker
                    value={timeValue}
                    onChange={setTimeValue}
                    placeholder={t('select_time')}
                  />
                </div>
                <span className='text-[var(--text-secondary)] text-sm'>{timeValue}</span>
              </VariantRow>
              <VariantRow label={t('size_sm')}>
                <div className='w-48'>
                  <TimePicker
                    value='14:00'
                    onChange={() => {}}
                    placeholder={t('small_size')}
                    size='sm'
                  />
                </div>
              </VariantRow>
              <VariantRow label={t('no_value')}>
                <div className='w-48'>
                  <TimePicker placeholder={t('select_time_2')} onChange={() => {}} />
                </div>
              </VariantRow>
              <VariantRow label={t('disabled')}>
                <div className='w-48'>
                  <TimePicker value='09:00' disabled />
                </div>
              </VariantRow>
            </Section>

            {/* ChipDatePicker */}
            <Section title={t('chipdatepicker')}>
              <VariantRow label={t('single_date')}>
                <div className='w-56'>
                  <ChipDatePicker
                    value={dateValue}
                    onChange={setDateValue}
                    placeholder={t('select_date')}
                    fullWidth
                  />
                </div>
                <span className='text-[var(--text-secondary)] text-sm'>
                  {dateValue || 'No date'}
                </span>
              </VariantRow>
              <VariantRow label={t('range_mode')}>
                <div className='w-72'>
                  <ChipDatePicker
                    mode='range'
                    startDate={dateRangeStart}
                    endDate={dateRangeEnd}
                    onRangeChange={(start, end) => {
                      setDateRangeStart(start)
                      setDateRangeEnd(end)
                    }}
                    placeholder={t('select_date_range')}
                    fullWidth
                  />
                </div>
              </VariantRow>
              <VariantRow label={t('range_mode_with_time')}>
                <div className='w-72'>
                  <ChipDatePicker
                    mode='range'
                    showTime
                    startDate={dateRangeStart}
                    endDate={dateRangeEnd}
                    onRangeChange={(start, end) => {
                      setDateRangeStart(start)
                      setDateRangeEnd(end)
                    }}
                    placeholder={t('select_date_range')}
                    fullWidth
                  />
                </div>
              </VariantRow>
              <VariantRow label={t('disabled')}>
                <div className='w-56'>
                  <ChipDatePicker value='2025-01-15' disabled fullWidth />
                </div>
              </VariantRow>
            </Section>

            {/* Tooltip */}
            <Section title={t('tooltip')}>
              <VariantRow label={t('default')}>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button variant='default'>{t('hover_me')}</Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content>{t('tooltip_content')}</Tooltip.Content>
                </Tooltip.Root>
              </VariantRow>
              <VariantRow label={t('with_shortcut')}>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button variant='default'>{t('clear_console')}</Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content>
                    <Tooltip.Shortcut keys='⌘D'>{t('clear_console')}</Tooltip.Shortcut>
                  </Tooltip.Content>
                </Tooltip.Root>
              </VariantRow>
              <VariantRow label={t('shortcut_only')}>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button variant='default'>{t('save')}</Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content>
                    <Tooltip.Shortcut keys='⌘S' />
                  </Tooltip.Content>
                </Tooltip.Root>
              </VariantRow>
            </Section>

            {/* Popover */}
            <Section title={t('popover')}>
              <VariantRow label={t('default')}>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant='default'>{t('open_popover')}</Button>
                  </PopoverTrigger>
                  <PopoverContent>
                    <PopoverSection>{t('section_title')}</PopoverSection>
                    <PopoverItem>{t('item_1')}</PopoverItem>
                    <PopoverItem>{t('item_2')}</PopoverItem>
                    <PopoverItem active>{t('active_item')}</PopoverItem>
                  </PopoverContent>
                </Popover>
              </VariantRow>
              <VariantRow label={t('secondary_variant')}>
                <Popover variant='secondary'>
                  <PopoverTrigger asChild>
                    <Button variant='secondary'>{t('secondary_popover')}</Button>
                  </PopoverTrigger>
                  <PopoverContent>
                    <PopoverItem>{t('item_1')}</PopoverItem>
                    <PopoverItem active>{t('active_item')}</PopoverItem>
                  </PopoverContent>
                </Popover>
              </VariantRow>
              <VariantRow label={t('with_search_2')}>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant='default'>{t('searchable_popover')}</Button>
                  </PopoverTrigger>
                  <PopoverContent>
                    <PopoverSearch placeholder={t('search_items')} />
                    <PopoverScrollArea className='max-h-40'>
                      <PopoverItem>{t('apple')}</PopoverItem>
                      <PopoverItem>{t('banana')}</PopoverItem>
                      <PopoverItem>{t('cherry')}</PopoverItem>
                      <PopoverItem>{t('date')}</PopoverItem>
                      <PopoverItem>{t('elderberry')}</PopoverItem>
                    </PopoverScrollArea>
                  </PopoverContent>
                </Popover>
              </VariantRow>
              <VariantRow label={t('with_folders')}>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant='default'>{t('folder_navigation')}</Button>
                  </PopoverTrigger>
                  <PopoverContent>
                    <PopoverBackButton />
                    <PopoverItem rootOnly>{t('root_item')}</PopoverItem>
                    <PopoverFolder
                      id='folder1'
                      title={t('folder_1')}
                      icon={<Folder className='size-3' />}
                    >
                      <PopoverItem>{t('nested_item_1')}</PopoverItem>
                      <PopoverItem>{t('nested_item_2')}</PopoverItem>
                    </PopoverFolder>
                    <PopoverFolder
                      id='folder2'
                      title={t('folder_2')}
                      icon={<Folder className='size-3' />}
                    >
                      <PopoverItem>{t('another_nested_item')}</PopoverItem>
                    </PopoverFolder>
                  </PopoverContent>
                </Popover>
              </VariantRow>
            </Section>

            {/* Modal */}
            <Section title={t('modal')}>
              <VariantRow label={t('sizes')}>
                {(['sm', 'md', 'lg', 'xl', 'full'] as const).map((size) => (
                  <Modal key={size}>
                    <ModalTrigger asChild>
                      <Button variant='default'>{size}</Button>
                    </ModalTrigger>
                    <ModalContent size={size}>
                      <ModalHeader>
                        {t('modal')} {size.toUpperCase()}
                      </ModalHeader>
                      <ModalBody>
                        <ModalDescription className='text-[var(--text-secondary)]'>
                          {t('this_is_a')} {size} {t('sized_modal')}
                        </ModalDescription>
                      </ModalBody>
                      <ModalFooter>
                        <Button variant='ghost'>{t('cancel')}</Button>
                        <Button variant='primary'>{t('save')}</Button>
                      </ModalFooter>
                    </ModalContent>
                  </Modal>
                ))}
              </VariantRow>
              <VariantRow label={t('with_tabs')}>
                <Modal>
                  <ModalTrigger asChild>
                    <Button variant='default'>{t('modal_with_tabs')}</Button>
                  </ModalTrigger>
                  <ModalContent>
                    <ModalHeader>{t('settings')}</ModalHeader>
                    <ModalTabs defaultValue='tab1'>
                      <ModalTabsList>
                        <ModalTabsTrigger value='tab1'>{t('general')}</ModalTabsTrigger>
                        <ModalTabsTrigger value='tab2'>{t('advanced')}</ModalTabsTrigger>
                      </ModalTabsList>
                      <ModalBody>
                        <ModalDescription className='sr-only'>
                          {t('modal_settings_with_general_and_advanced')}
                        </ModalDescription>
                        <ModalTabsContent value='tab1'>
                          <p className='text-[var(--text-secondary)]'>
                            {t('general_settings_content')}
                          </p>
                        </ModalTabsContent>
                        <ModalTabsContent value='tab2'>
                          <p className='text-[var(--text-secondary)]'>
                            {t('advanced_settings_content')}
                          </p>
                        </ModalTabsContent>
                      </ModalBody>
                    </ModalTabs>
                    <ModalFooter>
                      <Button variant='primary'>{t('save')}</Button>
                    </ModalFooter>
                  </ModalContent>
                </Modal>
              </VariantRow>
            </Section>

            {/* Code */}
            <Section title={t('code')}>
              <VariantRow label={t('javascript_2')}>
                <div className='w-full max-w-lg'>
                  <Code.Viewer code={SAMPLE_CODE} language='javascript' showGutter />
                </div>
              </VariantRow>
              <VariantRow label={t('json')}>
                <div className='w-full max-w-lg'>
                  <Code.Viewer
                    code={JSON.stringify({ name: 'Sim', version: '1.0' }, null, 2)}
                    language='json'
                    showGutter
                  />
                </div>
              </VariantRow>
              <VariantRow label={t('python_2')}>
                <div className='w-full max-w-lg'>
                  <Code.Viewer code={SAMPLE_PYTHON} language='python' showGutter />
                </div>
              </VariantRow>
              <VariantRow label={t('no_gutter')}>
                <div className='w-full max-w-lg'>
                  <Code.Viewer code={SAMPLE_CODE} language='javascript' />
                </div>
              </VariantRow>
              <VariantRow label={t('wrap_text')}>
                <div className='w-full max-w-lg'>
                  <Code.Viewer
                    code="const longLine = 'This is a very long line that should wrap when wrapText is enabled to demonstrate the text wrapping functionality';"
                    language='javascript'
                    showGutter
                    wrapText
                  />
                </div>
              </VariantRow>
            </Section>

            {/* Icons */}
            <Section title={t('icons')}>
              <div className='grid grid-cols-6 gap-4 sm:grid-cols-8 md:grid-cols-10'>
                {[
                  { Icon: BubbleChatClose, name: 'BubbleChatClose' },
                  { Icon: BubbleChatPreview, name: 'BubbleChatPreview' },
                  { Icon: CardIcon, name: 'Card' },
                  { Icon: ChevronDown, name: 'ChevronDown' },
                  { Icon: Connections, name: 'Connections' },
                  { Icon: Cursor, name: 'Cursor' },
                  { Icon: DocumentAttachment, name: 'DocumentAttachment' },
                  { Icon: Download, name: 'Download' },
                  { Icon: Duplicate, name: 'Duplicate' },
                  { Icon: Expand, name: 'Expand' },
                  { Icon: Eye, name: 'Eye' },
                  { Icon: FolderCode, name: 'FolderCode' },
                  { Icon: FolderPlus, name: 'FolderPlus' },
                  { Icon: Hand, name: 'Hand' },
                  { Icon: HexSimple, name: 'HexSimple' },
                  { Icon: KeyIcon, name: 'Key' },
                  { Icon: Layout, name: 'Layout' },
                  { Icon: Library, name: 'Library' },
                  { Icon: Loader, name: 'Loader' },
                  { Icon: MoreHorizontal, name: 'MoreHorizontal' },
                  { Icon: NoWrap, name: 'NoWrap' },
                  { Icon: PanelLeft, name: 'PanelLeft' },
                  { Icon: Play, name: 'Play' },
                  { Icon: PlayOutline, name: 'PlayOutline' },
                  { Icon: Redo, name: 'Redo' },
                  { Icon: Rocket, name: 'Rocket' },
                  { Icon: Trash, name: 'Trash' },
                  { Icon: Trash2, name: 'Trash2' },
                  { Icon: Undo, name: 'Undo' },
                  { Icon: Wrap, name: 'Wrap' },
                  { Icon: ZoomIn, name: 'ZoomIn' },
                  { Icon: ZoomOut, name: 'ZoomOut' },
                ].map(({ Icon, name }) => (
                  <Tooltip.Root key={name}>
                    <Tooltip.Trigger asChild>
                      <div className='flex size-10 cursor-pointer items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-2)] transition-colors hover:bg-[var(--surface-4)]'>
                        <Icon className='size-5 text-[var(--text-secondary)]' />
                      </div>
                    </Tooltip.Trigger>
                    <Tooltip.Content>{name}</Tooltip.Content>
                  </Tooltip.Root>
                ))}
              </div>
            </Section>
          </div>
        </div>
      </Tooltip.Provider>
    </ToastProvider>
  )
}
