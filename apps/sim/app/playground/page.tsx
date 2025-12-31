'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Bell, Folder, Key, Moon, Settings, Sun, User } from 'lucide-react'
import { notFound, useRouter } from 'next/navigation'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Breadcrumb,
  BubbleChatPreview,
  Button,
  Card as CardIcon,
  Checkbox,
  ChevronDown,
  Code,
  Combobox,
  Connections,
  Copy,
  DocumentAttachment,
  Duplicate,
  Eye,
  FolderCode,
  FolderPlus,
  HexSimple,
  Input,
  Key as KeyIcon,
  Label,
  Layout,
  Library,
  Modal,
  ModalBody,
  ModalContent,
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
  SModal,
  SModalContent,
  SModalMain,
  SModalMainBody,
  SModalMainHeader,
  SModalSidebar,
  SModalSidebarHeader,
  SModalSidebarItem,
  SModalSidebarSection,
  SModalSidebarSectionTitle,
  SModalTrigger,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  Tooltip,
  Trash,
  Trash2,
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

export default function PlaygroundPage() {
  const router = useRouter()
  const [comboboxValue, setComboboxValue] = useState('')
  const [switchValue, setSwitchValue] = useState(false)
  const [checkboxValue, setCheckboxValue] = useState(false)
  const [sliderValue, setSliderValue] = useState([50])
  const [activeTab, setActiveTab] = useState('profile')
  const [isDarkMode, setIsDarkMode] = useState(false)

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode)
    document.documentElement.classList.toggle('dark')
  }

  useEffect(() => {
    setIsDarkMode(document.documentElement.classList.contains('dark'))
  }, [])

  if (!isTruthy(env.NEXT_PUBLIC_ENABLE_PLAYGROUND)) {
    notFound()
  }

  return (
    <Tooltip.Provider>
      <div className='relative min-h-screen bg-[var(--bg)] p-8'>
        <div className='absolute top-8 left-8 flex items-center gap-2'>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button variant='ghost' onClick={() => router.back()} className='h-8 w-8 p-0'>
                <ArrowLeft className='h-4 w-4' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>Go back</Tooltip.Content>
          </Tooltip.Root>
        </div>
        <div className='absolute top-8 right-8'>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button variant='default' onClick={toggleDarkMode} className='h-8 w-8 p-0'>
                {isDarkMode ? <Sun className='h-4 w-4' /> : <Moon className='h-4 w-4' />}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>{isDarkMode ? 'Light mode' : 'Dark mode'}</Tooltip.Content>
          </Tooltip.Root>
        </div>
        <div className='mx-auto max-w-4xl space-y-12'>
          <div>
            <h1 className='font-semibold text-2xl text-[var(--text-primary)]'>
              EMCN Component Playground
            </h1>
            <p className='mt-2 text-[var(--text-secondary)]'>
              All emcn UI components and their variants
            </p>
          </div>

          {/* Button */}
          <Section title='Button'>
            <VariantRow label='default'>
              <Button variant='default'>Default</Button>
            </VariantRow>
            <VariantRow label='active'>
              <Button variant='active'>Active</Button>
            </VariantRow>
            <VariantRow label='3d'>
              <Button variant='3d'>3D</Button>
            </VariantRow>
            <VariantRow label='outline'>
              <Button variant='outline'>Outline</Button>
            </VariantRow>
            <VariantRow label='primary'>
              <Button variant='primary'>Primary</Button>
            </VariantRow>
            <VariantRow label='secondary'>
              <Button variant='secondary'>Secondary</Button>
            </VariantRow>
            <VariantRow label='tertiary'>
              <Button variant='tertiary'>Tertiary</Button>
            </VariantRow>
            <VariantRow label='ghost'>
              <Button variant='ghost'>Ghost</Button>
            </VariantRow>
            <VariantRow label='ghost-secondary'>
              <Button variant='ghost-secondary'>Ghost Secondary</Button>
            </VariantRow>
            <VariantRow label='disabled'>
              <Button disabled>Disabled</Button>
            </VariantRow>
          </Section>

          {/* Badge */}
          <Section title='Badge'>
            <VariantRow label='default'>
              <Badge variant='default'>Default</Badge>
            </VariantRow>
            <VariantRow label='outline'>
              <Badge variant='outline'>Outline</Badge>
            </VariantRow>
            <VariantRow label='green'>
              <Badge variant='green'>Green</Badge>
              <Badge variant='green' dot>
                With Dot
              </Badge>
            </VariantRow>
            <VariantRow label='red'>
              <Badge variant='red'>Red</Badge>
              <Badge variant='red' dot>
                With Dot
              </Badge>
            </VariantRow>
            <VariantRow label='blue'>
              <Badge variant='blue'>Blue</Badge>
              <Badge variant='blue' dot>
                With Dot
              </Badge>
            </VariantRow>
            <VariantRow label='blue-secondary'>
              <Badge variant='blue-secondary'>Blue Secondary</Badge>
            </VariantRow>
            <VariantRow label='purple'>
              <Badge variant='purple'>Purple</Badge>
            </VariantRow>
            <VariantRow label='orange'>
              <Badge variant='orange'>Orange</Badge>
            </VariantRow>
            <VariantRow label='amber'>
              <Badge variant='amber'>Amber</Badge>
            </VariantRow>
            <VariantRow label='teal'>
              <Badge variant='teal'>Teal</Badge>
            </VariantRow>
            <VariantRow label='gray'>
              <Badge variant='gray'>Gray</Badge>
            </VariantRow>
            <VariantRow label='gray-secondary'>
              <Badge variant='gray-secondary'>Gray Secondary</Badge>
            </VariantRow>
            <VariantRow label='sizes'>
              <Badge size='sm'>Small</Badge>
              <Badge size='md'>Medium</Badge>
              <Badge size='lg'>Large</Badge>
            </VariantRow>
          </Section>

          {/* Input */}
          <Section title='Input'>
            <VariantRow label='default'>
              <Input placeholder='Enter text...' className='max-w-xs' />
            </VariantRow>
            <VariantRow label='disabled'>
              <Input placeholder='Disabled' disabled className='max-w-xs' />
            </VariantRow>
          </Section>

          {/* Textarea */}
          <Section title='Textarea'>
            <Textarea placeholder='Enter your message...' className='max-w-md' rows={4} />
          </Section>

          {/* Label */}
          <Section title='Label'>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='demo-input'>Label Text</Label>
              <Input id='demo-input' placeholder='Input with label' className='max-w-xs' />
            </div>
          </Section>

          {/* Switch */}
          <Section title='Switch'>
            <VariantRow label='default'>
              <Switch checked={switchValue} onCheckedChange={setSwitchValue} />
              <span className='text-[var(--text-secondary)] text-sm'>
                {switchValue ? 'On' : 'Off'}
              </span>
            </VariantRow>
          </Section>

          {/* Checkbox */}
          <Section title='Checkbox'>
            <VariantRow label='default'>
              <Checkbox checked={checkboxValue} onCheckedChange={(c) => setCheckboxValue(!!c)} />
              <span className='text-[var(--text-secondary)] text-sm'>
                {checkboxValue ? 'Checked' : 'Unchecked'}
              </span>
            </VariantRow>
            <VariantRow label='size sm'>
              <Checkbox size='sm' />
              <span className='text-[var(--text-secondary)] text-sm'>Small (14px)</span>
            </VariantRow>
            <VariantRow label='size md'>
              <Checkbox size='md' />
              <span className='text-[var(--text-secondary)] text-sm'>Medium (16px)</span>
            </VariantRow>
            <VariantRow label='size lg'>
              <Checkbox size='lg' />
              <span className='text-[var(--text-secondary)] text-sm'>Large (20px)</span>
            </VariantRow>
            <VariantRow label='disabled'>
              <Checkbox disabled />
              <Checkbox disabled checked />
            </VariantRow>
          </Section>

          {/* Slider */}
          <Section title='Slider'>
            <VariantRow label='default'>
              <div className='w-48'>
                <Slider value={sliderValue} onValueChange={setSliderValue} max={100} step={1} />
              </div>
              <span className='text-[var(--text-secondary)] text-sm'>{sliderValue[0]}</span>
            </VariantRow>
            <VariantRow label='disabled'>
              <div className='w-48'>
                <Slider value={[30]} disabled max={100} step={1} />
              </div>
            </VariantRow>
          </Section>

          {/* Avatar */}
          <Section title='Avatar'>
            <VariantRow label='sizes'>
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
              <Avatar size='xl'>
                <AvatarFallback>XL</AvatarFallback>
              </Avatar>
            </VariantRow>
            <VariantRow label='with image'>
              <Avatar size='md'>
                <AvatarImage src='https://github.com/shadcn.png' alt='User' />
                <AvatarFallback>CN</AvatarFallback>
              </Avatar>
            </VariantRow>
            <VariantRow label='status online'>
              <Avatar size='md' status='online'>
                <AvatarFallback>JD</AvatarFallback>
              </Avatar>
            </VariantRow>
            <VariantRow label='status offline'>
              <Avatar size='md' status='offline'>
                <AvatarFallback>JD</AvatarFallback>
              </Avatar>
            </VariantRow>
            <VariantRow label='status busy'>
              <Avatar size='md' status='busy'>
                <AvatarFallback>JD</AvatarFallback>
              </Avatar>
            </VariantRow>
            <VariantRow label='status away'>
              <Avatar size='md' status='away'>
                <AvatarFallback>JD</AvatarFallback>
              </Avatar>
            </VariantRow>
            <VariantRow label='all sizes with status'>
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
              <Avatar size='xl' status='online'>
                <AvatarFallback>XL</AvatarFallback>
              </Avatar>
            </VariantRow>
          </Section>

          {/* Table */}
          <Section title='Table'>
            <VariantRow label='default'>
              <Table className='max-w-md'>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className='hover:bg-[var(--surface-2)]'>
                    <TableCell>Alice</TableCell>
                    <TableCell>Active</TableCell>
                    <TableCell>Admin</TableCell>
                  </TableRow>
                  <TableRow className='hover:bg-[var(--surface-2)]'>
                    <TableCell>Bob</TableCell>
                    <TableCell>Pending</TableCell>
                    <TableCell>User</TableCell>
                  </TableRow>
                  <TableRow className='hover:bg-[var(--surface-2)]'>
                    <TableCell>Charlie</TableCell>
                    <TableCell>Active</TableCell>
                    <TableCell>User</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </VariantRow>
          </Section>

          {/* Combobox */}
          <Section title='Combobox'>
            <VariantRow label='default'>
              <div className='w-48'>
                <Combobox
                  options={COMBOBOX_OPTIONS}
                  value={comboboxValue}
                  onChange={setComboboxValue}
                  placeholder='Select option...'
                />
              </div>
            </VariantRow>
            <VariantRow label='size sm'>
              <div className='w-48'>
                <Combobox
                  options={COMBOBOX_OPTIONS}
                  value=''
                  onChange={() => {}}
                  placeholder='Small size'
                  size='sm'
                />
              </div>
            </VariantRow>
            <VariantRow label='searchable'>
              <div className='w-48'>
                <Combobox
                  options={COMBOBOX_OPTIONS}
                  value=''
                  onChange={() => {}}
                  placeholder='With search'
                  searchable
                />
              </div>
            </VariantRow>
            <VariantRow label='editable'>
              <div className='w-48'>
                <Combobox
                  options={COMBOBOX_OPTIONS}
                  value=''
                  onChange={() => {}}
                  placeholder='Type or select...'
                  editable
                />
              </div>
            </VariantRow>
            <VariantRow label='multiSelect'>
              <div className='w-48'>
                <Combobox
                  options={COMBOBOX_OPTIONS}
                  multiSelectValues={[]}
                  onMultiSelectChange={() => {}}
                  placeholder='Select multiple...'
                  multiSelect
                  searchable
                />
              </div>
            </VariantRow>
          </Section>

          {/* Breadcrumb */}
          <Section title='Breadcrumb'>
            <Breadcrumb
              items={[
                { label: 'Home', href: '#' },
                { label: 'Settings', href: '#' },
                { label: 'Profile' },
              ]}
            />
          </Section>

          {/* Tooltip */}
          <Section title='Tooltip'>
            <VariantRow label='default'>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button variant='default'>Hover me</Button>
                </Tooltip.Trigger>
                <Tooltip.Content>Tooltip content</Tooltip.Content>
              </Tooltip.Root>
            </VariantRow>
          </Section>

          {/* Popover */}
          <Section title='Popover'>
            <VariantRow label='default'>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant='default'>Open Popover</Button>
                </PopoverTrigger>
                <PopoverContent>
                  <PopoverSection>Section Title</PopoverSection>
                  <PopoverItem>Item 1</PopoverItem>
                  <PopoverItem>Item 2</PopoverItem>
                  <PopoverItem active>Active Item</PopoverItem>
                </PopoverContent>
              </Popover>
            </VariantRow>
            <VariantRow label='secondary variant'>
              <Popover variant='secondary'>
                <PopoverTrigger asChild>
                  <Button variant='secondary'>Secondary Popover</Button>
                </PopoverTrigger>
                <PopoverContent>
                  <PopoverItem>Item 1</PopoverItem>
                  <PopoverItem active>Active Item</PopoverItem>
                </PopoverContent>
              </Popover>
            </VariantRow>
            <VariantRow label='with search'>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant='default'>Searchable Popover</Button>
                </PopoverTrigger>
                <PopoverContent>
                  <PopoverSearch placeholder='Search items...' />
                  <PopoverScrollArea className='max-h-40'>
                    <PopoverItem>Apple</PopoverItem>
                    <PopoverItem>Banana</PopoverItem>
                    <PopoverItem>Cherry</PopoverItem>
                    <PopoverItem>Date</PopoverItem>
                    <PopoverItem>Elderberry</PopoverItem>
                  </PopoverScrollArea>
                </PopoverContent>
              </Popover>
            </VariantRow>
            <VariantRow label='with folders'>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant='default'>Folder Navigation</Button>
                </PopoverTrigger>
                <PopoverContent>
                  <PopoverBackButton />
                  <PopoverItem rootOnly>Root Item</PopoverItem>
                  <PopoverFolder
                    id='folder1'
                    title='Folder 1'
                    icon={<Folder className='h-3 w-3' />}
                  >
                    <PopoverItem>Nested Item 1</PopoverItem>
                    <PopoverItem>Nested Item 2</PopoverItem>
                  </PopoverFolder>
                  <PopoverFolder
                    id='folder2'
                    title='Folder 2'
                    icon={<Folder className='h-3 w-3' />}
                  >
                    <PopoverItem>Another Nested Item</PopoverItem>
                  </PopoverFolder>
                </PopoverContent>
              </Popover>
            </VariantRow>
          </Section>

          {/* Modal */}
          <Section title='Modal'>
            <VariantRow label='sizes'>
              {(['sm', 'md', 'lg', 'xl', 'full'] as const).map((size) => (
                <Modal key={size}>
                  <ModalTrigger asChild>
                    <Button variant='default'>{size}</Button>
                  </ModalTrigger>
                  <ModalContent size={size}>
                    <ModalHeader>Modal {size.toUpperCase()}</ModalHeader>
                    <ModalBody>
                      <p className='text-[var(--text-secondary)]'>This is a {size} sized modal.</p>
                    </ModalBody>
                    <ModalFooter>
                      <Button variant='ghost'>Cancel</Button>
                      <Button variant='primary'>Save</Button>
                    </ModalFooter>
                  </ModalContent>
                </Modal>
              ))}
            </VariantRow>
            <VariantRow label='with tabs'>
              <Modal>
                <ModalTrigger asChild>
                  <Button variant='default'>Modal with Tabs</Button>
                </ModalTrigger>
                <ModalContent>
                  <ModalHeader>Settings</ModalHeader>
                  <ModalTabs defaultValue='tab1'>
                    <ModalTabsList>
                      <ModalTabsTrigger value='tab1'>General</ModalTabsTrigger>
                      <ModalTabsTrigger value='tab2'>Advanced</ModalTabsTrigger>
                    </ModalTabsList>
                    <ModalBody>
                      <ModalTabsContent value='tab1'>
                        <p className='text-[var(--text-secondary)]'>General settings content</p>
                      </ModalTabsContent>
                      <ModalTabsContent value='tab2'>
                        <p className='text-[var(--text-secondary)]'>Advanced settings content</p>
                      </ModalTabsContent>
                    </ModalBody>
                  </ModalTabs>
                  <ModalFooter>
                    <Button variant='primary'>Save</Button>
                  </ModalFooter>
                </ModalContent>
              </Modal>
            </VariantRow>
          </Section>

          {/* SModal (Sidebar Modal) */}
          <Section title='SModal (Sidebar Modal)'>
            <SModal>
              <SModalTrigger asChild>
                <Button variant='default'>Open Sidebar Modal</Button>
              </SModalTrigger>
              <SModalContent>
                <SModalSidebar>
                  <SModalSidebarHeader>Settings</SModalSidebarHeader>
                  <SModalSidebarSection>
                    <SModalSidebarSectionTitle>Account</SModalSidebarSectionTitle>
                    <SModalSidebarItem
                      icon={<User />}
                      active={activeTab === 'profile'}
                      onClick={() => setActiveTab('profile')}
                    >
                      Profile
                    </SModalSidebarItem>
                    <SModalSidebarItem
                      icon={<Key />}
                      active={activeTab === 'security'}
                      onClick={() => setActiveTab('security')}
                    >
                      Security
                    </SModalSidebarItem>
                  </SModalSidebarSection>
                  <SModalSidebarSection>
                    <SModalSidebarSectionTitle>Preferences</SModalSidebarSectionTitle>
                    <SModalSidebarItem
                      icon={<Bell />}
                      active={activeTab === 'notifications'}
                      onClick={() => setActiveTab('notifications')}
                    >
                      Notifications
                    </SModalSidebarItem>
                    <SModalSidebarItem
                      icon={<Settings />}
                      active={activeTab === 'general'}
                      onClick={() => setActiveTab('general')}
                    >
                      General
                    </SModalSidebarItem>
                  </SModalSidebarSection>
                </SModalSidebar>
                <SModalMain>
                  <SModalMainHeader>
                    {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
                  </SModalMainHeader>
                  <SModalMainBody>
                    <p className='text-[var(--text-secondary)]'>Content for {activeTab} tab</p>
                  </SModalMainBody>
                </SModalMain>
              </SModalContent>
            </SModal>
          </Section>

          {/* Code */}
          <Section title='Code'>
            <VariantRow label='javascript'>
              <div className='w-full max-w-lg'>
                <Code.Viewer code={SAMPLE_CODE} language='javascript' showGutter />
              </div>
            </VariantRow>
            <VariantRow label='json'>
              <div className='w-full max-w-lg'>
                <Code.Viewer
                  code={JSON.stringify({ name: 'Sim', version: '1.0' }, null, 2)}
                  language='json'
                  showGutter
                />
              </div>
            </VariantRow>
            <VariantRow label='python'>
              <div className='w-full max-w-lg'>
                <Code.Viewer code={SAMPLE_PYTHON} language='python' showGutter />
              </div>
            </VariantRow>
            <VariantRow label='no gutter'>
              <div className='w-full max-w-lg'>
                <Code.Viewer code={SAMPLE_CODE} language='javascript' />
              </div>
            </VariantRow>
            <VariantRow label='wrap text'>
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
          <Section title='Icons'>
            <div className='grid grid-cols-6 gap-4 sm:grid-cols-8 md:grid-cols-10'>
              {[
                { Icon: BubbleChatPreview, name: 'BubbleChatPreview' },
                { Icon: CardIcon, name: 'Card' },
                { Icon: ChevronDown, name: 'ChevronDown' },
                { Icon: Connections, name: 'Connections' },
                { Icon: Copy, name: 'Copy' },
                { Icon: DocumentAttachment, name: 'DocumentAttachment' },
                { Icon: Duplicate, name: 'Duplicate' },
                { Icon: Eye, name: 'Eye' },
                { Icon: FolderCode, name: 'FolderCode' },
                { Icon: FolderPlus, name: 'FolderPlus' },
                { Icon: HexSimple, name: 'HexSimple' },
                { Icon: KeyIcon, name: 'Key' },
                { Icon: Layout, name: 'Layout' },
                { Icon: Library, name: 'Library' },
                { Icon: MoreHorizontal, name: 'MoreHorizontal' },
                { Icon: NoWrap, name: 'NoWrap' },
                { Icon: PanelLeft, name: 'PanelLeft' },
                { Icon: Play, name: 'Play' },
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
                    <div className='flex h-10 w-10 cursor-pointer items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-2)] transition-colors hover:bg-[var(--surface-4)]'>
                      <Icon className='h-5 w-5 text-[var(--text-secondary)]' />
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
  )
}
