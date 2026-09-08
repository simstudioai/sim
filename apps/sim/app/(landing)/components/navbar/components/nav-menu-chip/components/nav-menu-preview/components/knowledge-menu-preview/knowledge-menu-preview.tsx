import { Badge, Chip } from '@sim/emcn'
import { ArrowUpDown, ChevronRight, Database, ListFilter, Search } from '@sim/emcn/icons'
import { DocxIcon, PdfIcon } from '@/components/icons/document-icons'
import { MenuPreviewFrame } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-frame'
import {
  MenuPreviewHeader,
  MenuPreviewToolbar,
} from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'

interface KnowledgeMenuPreviewProps {
  layout?: 'menu' | 'hero'
}

const DOCUMENTS = [
  {
    name: 'Product handbook.pdf',
    icon: PdfIcon,
    size: '1.2 MB',
    tokens: '24.8k',
    chunks: '64',
    uploaded: 'Sep 4',
  },
  {
    name: 'Support playbook.docx',
    icon: DocxIcon,
    size: '428 KB',
    tokens: '18.2k',
    chunks: '42',
    uploaded: 'Sep 3',
  },
  {
    name: 'Getting started.pdf',
    icon: PdfIcon,
    size: '864 KB',
    tokens: '12.6k',
    chunks: '31',
    uploaded: 'Sep 3',
  },
  {
    name: 'Security overview.pdf',
    icon: PdfIcon,
    size: '640 KB',
    tokens: '9.4k',
    chunks: '26',
    uploaded: 'Sep 2',
  },
  {
    name: 'Release notes.docx',
    icon: DocxIcon,
    size: '218 KB',
    tokens: '6.8k',
    chunks: '18',
    uploaded: 'Sep 1',
  },
] as const

/** The production knowledge document list, cropped around its content and indexing metadata. */
export function KnowledgeMenuPreview({ layout = 'menu' }: KnowledgeMenuPreviewProps) {
  return (
    <MenuPreviewFrame kind='knowledge' layout={layout}>
      <div className='w-[624px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] font-normal text-[13px] text-[var(--text-body)] shadow-xs'>
        <MenuPreviewHeader
          icon={Database}
          title={
            <>
              <span>Knowledge Base</span>
              <ChevronRight className='size-3 text-[var(--text-muted)]' />
              <span>Support</span>
            </>
          }
        />
        <MenuPreviewToolbar>
          <span className='mr-auto ml-2 flex items-center gap-2 text-[var(--text-muted)]'>
            <Search className='size-[14px]' />
            Search documents...
          </span>
          <Chip leftIcon={ListFilter} tabIndex={-1}>
            Filter
          </Chip>
          <Chip leftIcon={ArrowUpDown} tabIndex={-1}>
            Sort
          </Chip>
        </MenuPreviewToolbar>
        <table className='w-full table-fixed border-collapse whitespace-nowrap text-left'>
          <colgroup>
            <col className='w-[222px]' />
            <col className='w-[70px]' />
            <col className='w-[68px]' />
            <col className='w-[68px]' />
            <col className='w-[84px]' />
            <col className='w-[110px]' />
          </colgroup>
          <thead>
            <tr className='h-9 border-[var(--border)] border-b text-[var(--text-muted)]'>
              <th className='pl-4 font-normal'>Name</th>
              <th className='font-normal'>Size</th>
              <th className='font-normal'>Tokens</th>
              <th className='font-normal'>Chunks</th>
              <th className='font-normal'>Uploaded</th>
              <th className='font-normal'>Status</th>
            </tr>
          </thead>
          <tbody>
            {DOCUMENTS.map(({ name, icon: Icon, size, tokens, chunks, uploaded }) => (
              <tr key={name} className='h-11 text-[var(--text-secondary)]'>
                <td className='pl-4 text-[var(--text-body)]'>
                  <span className='flex items-center gap-2.5'>
                    <Icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                    <span className='truncate'>{name}</span>
                  </span>
                </td>
                <td className='tabular-nums'>{size}</td>
                <td className='tabular-nums'>{tokens}</td>
                <td className='tabular-nums'>{chunks}</td>
                <td>{uploaded}</td>
                <td>
                  <Badge variant='gray-secondary' size='sm'>
                    Enabled
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </MenuPreviewFrame>
  )
}
