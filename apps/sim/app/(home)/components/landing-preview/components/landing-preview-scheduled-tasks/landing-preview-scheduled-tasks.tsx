import { Calendar } from '@/components/emcn/icons'
import type {
  PreviewColumn,
  PreviewRow,
} from '@/app/(home)/components/landing-preview/components/landing-preview-resource/landing-preview-resource'
import { LandingPreviewResource } from '@/app/(home)/components/landing-preview/components/landing-preview-resource/landing-preview-resource'

const CAL_ICON = <Calendar className='h-[14px] w-[14px]' />

const COLUMNS: PreviewColumn[] = [
  { id: 'task', header: 'Task' },
  { id: 'schedule', header: 'Schedule', width: 240 },
  { id: 'nextRun', header: 'Next Run' },
  { id: 'lastRun', header: 'Last Run' },
]

const ROWS: PreviewRow[] = [
  {
    id: '1',
    cells: {
      task: { icon: CAL_ICON, label: 'Sync CRM contacts' },
      schedule: { label: 'Recurring, every day at 9:00 AM' },
      nextRun: { label: 'Tomorrow' },
      lastRun: { label: '2 hours ago' },
    },
  },
  {
    id: '2',
    cells: {
      task: { icon: CAL_ICON, label: 'Generate weekly report' },
      schedule: { label: 'Recurring, every Monday at 8:00 AM' },
      nextRun: { label: 'In 5 days' },
      lastRun: { label: '6 days ago' },
    },
  },
  {
    id: '3',
    cells: {
      task: { icon: CAL_ICON, label: 'Clean up stale files' },
      schedule: { label: 'Recurring, every Sunday at midnight' },
      nextRun: { label: 'In 2 days' },
      lastRun: { label: '6 days ago' },
    },
  },
  {
    id: '4',
    cells: {
      task: { icon: CAL_ICON, label: 'Send performance digest' },
      schedule: { label: 'Recurring, every Friday at 5:00 PM' },
      nextRun: { label: 'In 3 days' },
      lastRun: { label: '3 days ago' },
    },
  },
  {
    id: '5',
    cells: {
      task: { icon: CAL_ICON, label: 'Backup production data' },
      schedule: { label: 'Recurring, every 4 hours' },
      nextRun: { label: 'In 2 hours' },
      lastRun: { label: '2 hours ago' },
    },
  },
  {
    id: '6',
    cells: {
      task: { icon: CAL_ICON, label: 'Scrape competitor pricing' },
      schedule: { label: 'Recurring, every Tuesday at 6:00 AM' },
      nextRun: { label: 'In 6 days' },
      lastRun: { label: '1 week ago' },
    },
  },
]

/**
 * Static landing preview of the Scheduled Tasks workspace page.
 */
export function LandingPreviewScheduledTasks() {
  return (
    <LandingPreviewResource
      icon={Calendar}
      title='Scheduled Tasks'
      createLabel='New scheduled task'
      searchPlaceholder='Search scheduled tasks...'
      columns={COLUMNS}
      rows={ROWS}
    />
  )
}
