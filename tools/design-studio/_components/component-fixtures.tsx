'use client'

import { useState } from 'react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Banner,
  BarChart,
  BulkActionButton,
  Button,
  Calendar,
  CalendarDayCell,
  ChartDataTable,
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  ChartTooltipRow,
  Checkbox,
  Chip,
  ChipButtonGroup,
  ChipButtonGroupItem,
  ChipChevronDown,
  ChipCombobox,
  ChipConfirmModal,
  ChipCopyInput,
  ChipDatePicker,
  ChipDropdown,
  ChipEmailsInput,
  ChipInput,
  ChipLink,
  ChipModal,
  ChipModalBody,
  ChipModalDescription,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipModalPromptBody,
  ChipModalSeparator,
  ChipModalSurface,
  ChipModalTabs,
  ChipSelect,
  ChipSwitch,
  ChipTag,
  ChipTextarea,
  ChipTimePicker,
  Code,
  CollapsibleCard,
  Combobox,
  ComposerActionButton,
  CopyCodeButton,
  DashboardMetric,
  DashedDividerLine,
  DetailsPanel,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuItemAction,
  DropdownMenuItemLabel,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSearchInput,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Expandable,
  ExpandableContent,
  FieldDivider,
  FloatingTooltip,
  Info,
  InfoCard,
  InfoCardItem,
  InfoCardList,
  Input,
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
  Label,
  Lightbox,
  LineChart,
  LogoPage,
  Modal,
  ModalBody,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTabs,
  ModalTabsContent,
  ModalTabsList,
  ModalTabsTrigger,
  ModalTitle,
  ModalTrigger,
  OverflowText,
  Popover,
  PopoverBackButton,
  PopoverContent,
  PopoverDivider,
  PopoverFolder,
  PopoverItem,
  PopoverScrollArea,
  PopoverSearch,
  PopoverSection,
  PopoverTrigger,
  ProgressItem,
  RadarChart,
  RowActions,
  SecretInput,
  SecretReveal,
  SimWordmark,
  Skeleton,
  Slider,
  StatusPageContent,
  Switch,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TabStrip,
  TabStripAction,
  TagInput,
  Textarea,
  TimePicker,
  ToastProvider,
  Tooltip,
  UploadPreviewButton,
  useToast,
  Wizard,
} from '@sim/emcn'
import { ArrowUp, Search } from '@sim/emcn/icons'

function ToastTrigger() {
  const { toast } = useToast()
  return (
    <Button onClick={() => toast.success('Saved example', { description: 'Studio preview' })}>
      Show toast
    </Button>
  )
}

interface ComponentPreviewProps {
  id: string
  variant?: { axis: string; value: string }
  variants?: Record<string, string>
  interactive?: boolean
  state?: string
}

export function ComponentPreview({
  id,
  variant,
  variants,
  interactive = false,
  state,
}: ComponentPreviewProps) {
  const [selection, setSelection] = useState('alpha')
  const [date, setDate] = useState('2026-09-23')
  const [time, setTime] = useState('09:30')
  const [secret, setSecret] = useState('example-secret')
  const [emails, setEmails] = useState(['design@sim.ai'])
  const [tags, setTags] = useState([{ value: 'design', isValid: true }])
  const [otp, setOtp] = useState('123456')
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const selections = { ...(variant ? { [variant.axis]: variant.value } : {}), ...variants }
  const hasVariants = Object.keys(selections).length > 0
  const variantProps = Object.fromEntries(
    Object.entries(selections).map(([axis, value]) => [
      axis,
      value === 'true' ? true : value === 'false' ? false : value,
    ])
  )
  switch (id) {
    case 'bulk-action-button':
      return (
        <BulkActionButton aria-label='Remove selected items' {...variantProps}>
          ×
        </BulkActionButton>
      )
    case 'row-actions':
      return (
        <div className='group/row-actions flex items-center gap-2'>
          <span className='text-[var(--text-body)] text-sm'>Example row</span>
          <RowActions
            open
            indicator={<span className='size-2 rounded-full bg-[var(--brand)]' />}
            {...variantProps}
          >
            <Button size='sm' variant='ghost' aria-label='Edit row'>
              •••
            </Button>
          </RowActions>
        </div>
      )
    case 'composer-action-button':
      return (
        <ComposerActionButton aria-label='Send example' {...variantProps}>
          <ArrowUp className='size-4 text-white dark:text-black' />
        </ComposerActionButton>
      )
    case 'upload-preview-button':
      return <UploadPreviewButton aria-label='Choose example image' />
    case 'button':
      if (state === 'disabled') return <Button disabled>Disabled button</Button>
      if (hasVariants || interactive) return <Button {...variantProps}>Button</Button>
      return (
        <div className='flex flex-wrap items-center gap-3'>
          <Button variant='primary'>Primary</Button>
          <Button variant='default'>Default</Button>
          <Button variant='quiet'>Quiet</Button>
          <Button variant='destructive'>Delete</Button>
        </div>
      )
    case 'bar-chart':
      return (
        <div className='w-full max-w-72'>
          <BarChart
            label='Example runs'
            color='var(--brand)'
            height={120}
            data={[
              { timestamp: '2026-09-20T00:00:00Z', value: 3 },
              { timestamp: '2026-09-21T00:00:00Z', value: 6 },
              { timestamp: '2026-09-22T00:00:00Z', value: 4 },
              { timestamp: '2026-09-23T00:00:00Z', value: 8 },
            ]}
          />
        </div>
      )
    case 'line-chart':
      return (
        <div className='w-full max-w-72'>
          <LineChart
            label='Example trend'
            color='var(--brand)'
            height={120}
            data={[
              { timestamp: '2026-09-20T00:00:00Z', value: 3 },
              { timestamp: '2026-09-21T00:00:00Z', value: 6 },
              { timestamp: '2026-09-22T00:00:00Z', value: 4 },
              { timestamp: '2026-09-23T00:00:00Z', value: 8 },
            ]}
          />
        </div>
      )
    case 'radar-chart':
      return (
        <div className='w-full max-w-72'>
          <RadarChart
            color='var(--brand)'
            height={150}
            axes={[
              { label: 'Speed', value: 8 },
              { label: 'Quality', value: 6 },
              { label: 'Reach', value: 9 },
              { label: 'Cost', value: 5 },
            ]}
          />
        </div>
      )
    case 'chart-frame':
      return (
        <div className='w-full max-w-72'>
          <ChartFrame title='Example activity' height={110} loading>
            {null}
          </ChartFrame>
        </div>
      )
    case 'chart-legend':
      return (
        <ChartLegend
          layout='row'
          items={[
            { id: 'success', label: 'Success', color: 'var(--brand)', value: '8' },
            { id: 'other', label: 'Other', color: 'var(--text-muted)', value: '3' },
          ]}
          selectedId={null}
          highlightedId={null}
          onHighlight={() => undefined}
          onSelect={() => undefined}
          {...variantProps}
        />
      )
    case 'chart-tooltip':
      return (
        <div className='relative h-24 w-44'>
          <ChartTooltip left={0} top={0} date='Today'>
            <ChartTooltipRow color='var(--brand)' label='Runs' value='8' />
          </ChartTooltip>
        </div>
      )
    case 'chart-data-table':
      return (
        <div className='text-[var(--text-muted)] text-xs'>
          <ChartDataTable
            label='Example values'
            series={[
              {
                id: 'runs',
                label: 'Runs',
                data: [{ timestamp: '2026-09-23T00:00:00Z', value: 8 }],
              },
            ]}
          />
          Accessible table for charts
        </div>
      )
    case 'dashboard-metric':
      return <DashboardMetric label='Total runs' value='1,284' />
    case 'code':
      return (
        <div className='max-h-32 w-full max-w-72 overflow-auto rounded-md border border-[var(--border)]'>
          <CopyCodeButton code='const example = true' />
          <Code.Viewer
            code={'const run = async () => {\n  return true\n}'}
            language='javascript'
            showGutter
            {...variantProps}
          />
        </div>
      )
    case 'chip':
      if (hasVariants || interactive || state === 'disabled')
        return (
          <Chip {...variantProps} disabled={state === 'disabled'}>
            Chip
          </Chip>
        )
      return (
        <div className='flex flex-wrap items-center gap-3'>
          <Chip>Default</Chip>
          <Chip active>Selected</Chip>
          <Chip variant='border'>Border</Chip>
          <Chip variant='primary'>Primary</Chip>
          <ChipLink href='#studio-example'>Linked</ChipLink>
          <ChipChevronDown />
        </div>
      )
    case 'chip-button-group':
      return (
        <ChipButtonGroup value='code' {...variantProps}>
          <ChipButtonGroupItem value='code'>Code</ChipButtonGroupItem>
          <ChipButtonGroupItem value='preview'>Preview</ChipButtonGroupItem>
        </ChipButtonGroup>
      )
    case 'chip-dropdown':
      return (
        <ChipDropdown
          aria-label='Example mode'
          options={[
            { value: 'build', label: 'Build' },
            { value: 'plan', label: 'Plan' },
          ]}
          value='build'
          onChange={() => undefined}
        />
      )
    case 'chip-combobox':
      return (
        <ChipCombobox
          aria-label='Example source'
          className='max-w-64'
          options={[
            { value: 'alpha', label: 'First source' },
            { value: 'beta', label: 'Second source' },
          ]}
          value={selection}
          onChange={setSelection}
        />
      )
    case 'chip-copy-input':
      return (
        <ChipCopyInput aria-label='Example identifier' value='example_123' className='max-w-64' />
      )
    case 'chip-date-picker':
      return <ChipDatePicker value={date} onChange={setDate} {...variantProps} />
    case 'chip-emails-input':
      return (
        <div className='w-full max-w-64'>
          <ChipEmailsInput
            value={emails}
            onChange={setEmails}
            variant='default'
            {...variantProps}
          />
        </div>
      )
    case 'chip-modal-field': {
      if (selections.type === 'dropdown')
        return (
          <ChipModalField
            type='dropdown'
            title='Mode'
            value={selection}
            onChange={setSelection}
            options={[
              { value: 'alpha', label: 'First option' },
              { value: 'beta', label: 'Second option' },
            ]}
            {...variantProps}
          />
        )
      if (selections.type === 'emails')
        return (
          <ChipModalField
            type='emails'
            title='Recipients'
            value={emails}
            onChange={setEmails}
            {...variantProps}
          />
        )
      if (selections.type === 'file')
        return (
          <ChipModalField
            type='file'
            title='Attachment'
            onChange={() => undefined}
            {...variantProps}
          />
        )
      if (selections.type === 'custom')
        return (
          <ChipModalField type='custom' title='Custom field' {...variantProps}>
            <p>Example content</p>
          </ChipModalField>
        )
      return (
        <ChipModalField
          type='input'
          title='Name'
          value={secret}
          onChange={setSecret}
          {...variantProps}
        />
      )
    }
    case 'chip-modal': {
      const sizeSelected = Boolean(selections.size)
      return (
        <div className='flex w-full max-w-72 flex-col items-center gap-3'>
          <ChipModalSurface className='w-full'>
            <ChipModalHeader onClose={() => undefined} closeDisabled>
              Example settings
            </ChipModalHeader>
            <ChipModalBody>
              <ChipModalDescription>Shared modal surface and header.</ChipModalDescription>
              <ChipModalField
                type='input'
                title='Name'
                value='Example'
                onChange={() => undefined}
                {...(sizeSelected ? {} : variantProps)}
              />
              <ChipModalError>Example validation error</ChipModalError>
              <ChipModalTabs
                tabs={[
                  { value: 'one', label: 'One' },
                  { value: 'two', label: 'Two' },
                ]}
                value='one'
                onChange={() => undefined}
              />
              <ChipModalSeparator />
            </ChipModalBody>
            <ChipModalPromptBody>
              <textarea aria-label='Example prompt' defaultValue='A short prompt' />
            </ChipModalPromptBody>
            <ChipModalFooter
              onCancel={() => undefined}
              primaryAction={{ label: 'Save', onClick: () => undefined }}
            />
          </ChipModalSurface>
          <Button onClick={() => setOpen(true)}>Open full dialog</Button>
          <ChipModal
            open={sizeSelected || open}
            onOpenChange={setOpen}
            srTitle='Example settings'
            {...(sizeSelected ? variantProps : {})}
          >
            <ChipModalHeader onClose={() => setOpen(false)}>Example settings</ChipModalHeader>
            <ChipModalBody>
              <p className='px-2 py-4 text-[var(--text-body)] text-sm'>The full EMCN dialog.</p>
            </ChipModalBody>
          </ChipModal>
        </div>
      )
    }
    case 'chip-confirm-modal':
      return (
        <ChipConfirmModal
          open
          onOpenChange={() => undefined}
          title='Delete example?'
          text='This action removes the example.'
          confirm={{ label: 'Delete', onClick: () => undefined }}
        />
      )
    case 'chip-input':
      return (
        <ChipInput
          aria-label='Example filter'
          icon={Search}
          placeholder='Search…'
          className='max-w-64'
          disabled={state === 'disabled'}
        />
      )
    case 'chip-select':
      return (
        <ChipSelect
          aria-label='Example filter'
          options={[
            { value: 'all', label: 'All items' },
            { value: 'mine', label: 'Mine' },
          ]}
          value='all'
          onChange={() => undefined}
          {...variantProps}
        />
      )
    case 'chip-tag':
      if (hasVariants || interactive) return <ChipTag {...variantProps}>Tag</ChipTag>
      return (
        <div className='flex flex-wrap items-center gap-3'>
          <ChipTag variant='mono'>Mono</ChipTag>
          <ChipTag variant='gray'>Gray</ChipTag>
          <ChipTag variant='solid'>Solid</ChipTag>
        </div>
      )
    case 'chip-switch':
      return (
        <ChipSwitch
          aria-label='Billing interval'
          value='monthly'
          onChange={() => undefined}
          options={[
            { value: 'monthly', label: 'Monthly' },
            { value: 'annual', label: 'Annual' },
          ]}
          {...variantProps}
        />
      )
    case 'chip-textarea':
      return (
        <ChipTextarea
          aria-label='Example description'
          rows={2}
          placeholder='Description…'
          className='max-w-64'
        />
      )
    case 'chip-time-picker':
      return <ChipTimePicker value={time} onChange={setTime} />
    case 'badge':
      if (hasVariants || interactive) return <Badge {...variantProps}>Badge</Badge>
      return (
        <div className='flex flex-wrap items-center gap-3'>
          <Badge>Default</Badge>
          <Badge variant='green' dot>
            Success
          </Badge>
          <Badge variant='red' dot>
            Error
          </Badge>
          <Badge variant='blue' dot>
            Info
          </Badge>
        </div>
      )
    case 'avatar':
      return (
        <Avatar {...variantProps}>
          <AvatarImage src='/static/readme-files.png' alt='Example' />
          <AvatarFallback>BL</AvatarFallback>
        </Avatar>
      )
    case 'banner':
      return (
        <Banner text='A shared banner treatment' className='w-full max-w-64' {...variantProps} />
      )
    case 'status-page':
      return (
        <div className='scale-75'>
          <StatusPageContent title='Offline' description='Reconnect to continue.'>
            <Button variant='primary'>Retry</Button>
          </StatusPageContent>
        </div>
      )
    case 'logo-page':
      return (
        <div className='h-40 w-full overflow-hidden'>
          <LogoPage logo={<SimWordmark />} center>
            <p className='text-sm'>Example status page</p>
          </LogoPage>
        </div>
      )
    case 'info':
      return (
        <div className='flex items-center gap-2 text-[var(--text-body)] text-sm'>
          Trigger setting <Info>Why this setting matters</Info>
        </div>
      )
    case 'info-card':
      return (
        <InfoCard className='w-full max-w-64'>
          <InfoCardList>
            <InfoCardItem>Read files</InfoCardItem>
            <InfoCardItem>Share results</InfoCardItem>
          </InfoCardList>
        </InfoCard>
      )
    case 'input':
      return (
        <Input
          aria-label='Example input'
          placeholder='Enter a value…'
          className='max-w-64'
          disabled={state === 'disabled'}
          aria-invalid={state === 'error'}
        />
      )
    case 'combobox':
      return (
        <Combobox
          aria-label='Example choice'
          className='max-w-64'
          options={[
            { value: 'alpha', label: 'First choice' },
            { value: 'beta', label: 'Second choice' },
          ]}
          value={selection}
          onChange={setSelection}
          {...variantProps}
        />
      )
    case 'input-otp':
      return (
        <InputOTP maxLength={6} value={otp} onChange={setOtp} aria-label='Example code'>
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>
      )
    case 'secret-input':
      return (
        <SecretInput
          aria-label='Example secret'
          className='max-w-64'
          value={secret}
          onChange={setSecret}
        />
      )
    case 'secret-reveal':
      return (
        <div className='w-full max-w-64 space-y-2'>
          <SecretReveal value='sim_example_secret' />
          <SecretReveal redacted />
        </div>
      )
    case 'tag-input':
      return (
        <TagInput
          className='max-w-64'
          items={tags}
          onAdd={(value) => {
            setTags((current) => [...current, { value, isValid: true }])
            return true
          }}
          onRemove={(_value, index) => setTags((current) => current.filter((_, i) => i !== index))}
          placeholder='Add a tag'
          {...variantProps}
        />
      )
    case 'time-picker':
      return (
        <TimePicker
          aria-label='Example time'
          className='max-w-48'
          value={time}
          onChange={setTime}
          {...variantProps}
        />
      )
    case 'textarea':
      return (
        <Textarea
          aria-label='Example message'
          placeholder='Write a message…'
          className='max-w-64'
          disabled={state === 'disabled'}
        />
      )
    case 'label':
      return (
        <div className='w-48 space-y-2'>
          <Label htmlFor='fixture-label-input'>Field label</Label>
          <Input id='fixture-label-input' placeholder='Value' />
        </div>
      )
    case 'checkbox':
      if (hasVariants || interactive || state === 'disabled')
        return (
          <Checkbox
            aria-label='Variant example'
            defaultChecked
            disabled={state === 'disabled'}
            {...variantProps}
          />
        )
      return (
        <div className='flex items-center gap-4'>
          <Checkbox aria-label='Unchecked example' />
          <Checkbox aria-label='Checked example' defaultChecked />
          <span className='text-[var(--text-body)] text-xs'>Unchecked / checked</span>
        </div>
      )
    case 'switch':
      return (
        <div className='flex items-center gap-4'>
          <Switch aria-label='Off example' />
          <Switch aria-label='On example' defaultChecked />
        </div>
      )
    case 'slider':
      return <Slider aria-label='Example value' defaultValue={[58]} className='max-w-48' />
    case 'skeleton':
      return (
        <div className='w-full max-w-64 space-y-2'>
          <Skeleton className='h-4 w-2/3' />
          <Skeleton className='h-4 w-full' />
          <Skeleton className='h-4 w-5/6' />
        </div>
      )
    case 'progress-item':
      return (
        <div className='w-full max-w-72'>
          <ProgressItem
            title='data.csv'
            meta='Done'
            detail='120 rows imported'
            {...variantProps}
            status={(selections.status as 'pending' | 'success' | 'error' | undefined) ?? 'success'}
          />
        </div>
      )
    case 'field-divider':
      return (
        <div className='w-60'>
          <DashedDividerLine />
          <FieldDivider />
        </div>
      )
    case 'overflow-text':
      return (
        <OverflowText
          label='A long resource name that fades at the edge'
          className='w-36 text-sm'
        />
      )
    case 'sim-wordmark':
      return <SimWordmark {...variantProps} />
    case 'table':
      return (
        <Table {...variantProps}>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Example</TableCell>
              <TableCell>Ready</TableCell>
            </TableRow>
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2}>One result</TableCell>
            </TableRow>
          </TableFooter>
          <TableCaption>Example table</TableCaption>
        </Table>
      )
    case 'calendar':
      return (
        <div>
          <Calendar value={date} today='2026-09-23' onChange={setDate} />
          <CalendarDayCell selected>23</CalendarDayCell>
        </div>
      )
    case 'tab-strip':
      return (
        <div className='w-full max-w-72 border-[var(--border)] border-b bg-[var(--surface-3)]'>
          <TabStrip
            tabs={[
              { id: 'alpha', title: 'Overview', active: selection === 'alpha' },
              { id: 'beta', title: 'Activity', active: selection === 'beta' },
            ]}
            onSelect={setSelection}
          />
          <TabStripAction aria-label='More tab actions'>•••</TabStripAction>
        </div>
      )
    case 'details-panel':
      return (
        <div className='relative h-36 w-full max-w-72 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-3)]'>
          <DetailsPanel
            open
            width={190}
            onResizeStart={() => undefined}
            resizeLabel='Resize preview panel'
            aria-label='Example details panel'
          >
            <div className='p-3 text-[var(--text-body)] text-xs'>Selected item details</div>
          </DetailsPanel>
        </div>
      )
    case 'collapsible-card':
      return (
        <CollapsibleCard
          title='Condition'
          collapsed={false}
          onToggleCollapse={() => undefined}
          className='w-full max-w-64'
        >
          <span className='text-[var(--text-body)] text-xs'>A field description</span>
        </CollapsibleCard>
      )
    case 'expandable':
      return (
        <Expandable expanded className='max-w-64'>
          <ExpandableContent>
            <div className='rounded-md border border-[var(--border)] p-3 text-[var(--text-body)] text-xs'>
              Expanded content
            </div>
          </ExpandableContent>
        </Expandable>
      )
    case 'dropdown-menu':
      return (
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger asChild>
            <Button>Open menu</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSearchInput placeholder='Find an action' />
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem {...variantProps}>
                <DropdownMenuItemLabel label='First action' />
                <DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
                <DropdownMenuItemAction aria-label='More action'>•••</DropdownMenuItemAction>
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem checked>Include files</DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value='recent'>
              <DropdownMenuRadioItem value='recent'>Recent</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More choices</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Nested action</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    case 'dropdown-menu-sub-content':
      return (
        <div className='-translate-x-24'>
          <DropdownMenu defaultOpen>
            <DropdownMenuTrigger asChild>
              <Button>Open menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>More choices</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem>Nested action</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )
    case 'popover':
      return (
        <Popover defaultOpen>
          <PopoverTrigger asChild>
            <Button>Open popover</Button>
          </PopoverTrigger>
          <PopoverContent {...variantProps}>
            <PopoverSearch placeholder='Find a page' />
            <PopoverScrollArea>
              <PopoverSection>Recent</PopoverSection>
              <PopoverItem onClick={() => undefined}>First action</PopoverItem>
              <PopoverFolder id='examples' title='Examples'>
                <PopoverBackButton>Back</PopoverBackButton>
                <PopoverItem onClick={() => undefined}>Nested item</PopoverItem>
              </PopoverFolder>
              <PopoverDivider />
              <PopoverItem onClick={() => undefined}>Second action</PopoverItem>
            </PopoverScrollArea>
          </PopoverContent>
        </Popover>
      )
    case 'modal':
      return (
        <Modal defaultOpen>
          <ModalTrigger asChild>
            <Button>Open modal</Button>
          </ModalTrigger>
          <ModalOverlay />
          <ModalContent srTitle='Example modal'>
            <ModalHeader>Example modal</ModalHeader>
            <ModalTitle>Shared dialog chrome</ModalTitle>
            <ModalDescription className='px-4'>Shared dialog chrome.</ModalDescription>
            <ModalBody>
              <p className='text-[var(--text-body)] text-sm'>This is the rendered EMCN modal.</p>
              <ModalTabs defaultValue='first'>
                <ModalTabsList>
                  <ModalTabsTrigger value='first'>First</ModalTabsTrigger>
                  <ModalTabsTrigger value='second'>Second</ModalTabsTrigger>
                </ModalTabsList>
                <ModalTabsContent value='first'>First tab content</ModalTabsContent>
                <ModalTabsContent value='second'>Second tab content</ModalTabsContent>
              </ModalTabs>
            </ModalBody>
            <ModalFooter>
              <ModalClose asChild>
                <Button>Close</Button>
              </ModalClose>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )
    case 'wizard':
      return (
        <>
          <Button onClick={() => setOpen(true)}>Open wizard</Button>
          <Wizard open={open} onOpenChange={setOpen} currentStep={step} onStepChange={setStep}>
            <Wizard.Step title='Configure'>Choose your settings.</Wizard.Step>
            <Wizard.Step title='Review'>Review the configuration.</Wizard.Step>
          </Wizard>
        </>
      )
    case 'lightbox':
      return (
        <Lightbox src='/static/readme-files.png' alt='Files preview'>
          <button
            type='button'
            className='overflow-hidden rounded-md border border-[var(--border)]'
          >
            <img
              src='/static/readme-files.png'
              alt='Open files preview'
              className='h-24 w-auto object-cover'
            />
          </button>
        </Lightbox>
      )
    case 'toast':
      return (
        <ToastProvider>
          <ToastTrigger />
        </ToastProvider>
      )
    case 'tooltip':
      return (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button>Hover for tooltip</Button>
          </Tooltip.Trigger>
          <Tooltip.Content>Helpful detail</Tooltip.Content>
        </Tooltip.Root>
      )
    case 'floating-tooltip':
      return (
        <FloatingTooltip
          role='tooltip'
          label='A floating tip'
          state={{
            visible: true,
            x: 170,
            y: 155,
            skew: 0,
            scaleX: 1,
            scaleY: 1,
            alignX: 'left',
            alignY: 'below',
          }}
        />
      )
    default:
      return (
        <div data-studio-unavailable className='text-center text-[var(--text-muted)] text-xs'>
          Preview fixture to add
        </div>
      )
  }
}
