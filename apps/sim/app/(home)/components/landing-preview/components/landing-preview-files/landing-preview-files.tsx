import { File } from '@/components/emcn/icons'
import { DocxIcon, PdfIcon } from '@/components/icons/document-icons'
import type {
  PreviewColumn,
  PreviewRow,
} from '@/app/(home)/components/landing-preview/components/landing-preview-resource/landing-preview-resource'
import {
  LandingPreviewResource,
  ownerCell,
} from '@/app/(home)/components/landing-preview/components/landing-preview-resource/landing-preview-resource'

/** Generic audio/zip icon using basic SVG since no dedicated component exists */
function AudioIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
      className={className}
    >
      <path d='M9 18V5l12-2v13' />
      <circle cx='6' cy='18' r='3' />
      <circle cx='18' cy='16' r='3' />
    </svg>
  )
}

function JsonlIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
      className={className}
    >
      <path d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' />
      <path d='M14 2v4a2 2 0 0 0 2 2h4' />
      <path d='M10 9H8' />
      <path d='M16 13H8' />
      <path d='M16 17H8' />
    </svg>
  )
}

function ZipIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
      className={className}
    >
      <path d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' />
      <path d='M14 2v4a2 2 0 0 0 2 2h4' />
      <path d='M10 6h1' />
      <path d='M10 10h1' />
      <path d='M10 14h1' />
      <path d='M9 18h2v2h-2z' />
    </svg>
  )
}

const COLUMNS: PreviewColumn[] = [
  { id: 'name', header: 'Name' },
  { id: 'size', header: 'Size' },
  { id: 'type', header: 'Type' },
  { id: 'created', header: 'Created' },
  { id: 'owner', header: 'Owner' },
]

const ROWS: PreviewRow[] = [
  {
    id: '1',
    cells: {
      name: { icon: <PdfIcon className='h-[14px] w-[14px]' />, label: 'Q1 Performance Report.pdf' },
      size: { label: '2.4 MB' },
      type: { icon: <PdfIcon className='h-[14px] w-[14px]' />, label: 'PDF' },
      created: { label: '3 hours ago' },
      owner: ownerCell('T', 'Theo L.'),
    },
  },
  {
    id: '2',
    cells: {
      name: { icon: <ZipIcon className='h-[14px] w-[14px]' />, label: 'product-screenshots.zip' },
      size: { label: '18.7 MB' },
      type: { icon: <ZipIcon className='h-[14px] w-[14px]' />, label: 'ZIP' },
      created: { label: '1 day ago' },
      owner: ownerCell('A', 'Alex M.'),
    },
  },
  {
    id: '3',
    cells: {
      name: { icon: <JsonlIcon className='h-[14px] w-[14px]' />, label: 'training-dataset.jsonl' },
      size: { label: '892 KB' },
      type: { icon: <JsonlIcon className='h-[14px] w-[14px]' />, label: 'JSONL' },
      created: { label: '3 days ago' },
      owner: ownerCell('J', 'Jordan P.'),
    },
  },
  {
    id: '4',
    cells: {
      name: { icon: <PdfIcon className='h-[14px] w-[14px]' />, label: 'brand-guidelines.pdf' },
      size: { label: '5.1 MB' },
      type: { icon: <PdfIcon className='h-[14px] w-[14px]' />, label: 'PDF' },
      created: { label: '1 week ago' },
      owner: ownerCell('S', 'Sarah K.'),
    },
  },
  {
    id: '5',
    cells: {
      name: { icon: <AudioIcon className='h-[14px] w-[14px]' />, label: 'customer-interviews.mp3' },
      size: { label: '45.2 MB' },
      type: { icon: <AudioIcon className='h-[14px] w-[14px]' />, label: 'Audio' },
      created: { label: 'March 20th, 2026' },
      owner: ownerCell('V', 'Vik M.'),
    },
  },
  {
    id: '6',
    cells: {
      name: { icon: <DocxIcon className='h-[14px] w-[14px]' />, label: 'onboarding-playbook.docx' },
      size: { label: '1.1 MB' },
      type: { icon: <DocxIcon className='h-[14px] w-[14px]' />, label: 'DOCX' },
      created: { label: 'March 14th, 2026' },
      owner: ownerCell('S', 'Sarah K.'),
    },
  },
]

/**
 * Static landing preview of the Files workspace page.
 */
export function LandingPreviewFiles() {
  return (
    <LandingPreviewResource
      icon={File}
      title='Files'
      createLabel='Upload file'
      searchPlaceholder='Search files...'
      columns={COLUMNS}
      rows={ROWS}
    />
  )
}
