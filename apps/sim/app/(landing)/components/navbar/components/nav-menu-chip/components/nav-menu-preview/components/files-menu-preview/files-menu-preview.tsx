import { Chip } from '@sim/emcn'
import { ArrowUpDown, Files, Folder, ListFilter, Search } from '@sim/emcn/icons'
import { CsvIcon, DocxIcon, PdfIcon } from '@/components/icons/document-icons'
import { MenuPreviewFrame } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-frame'
import {
  MenuPreviewHeader,
  MenuPreviewToolbar,
} from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'

interface FilesMenuPreviewProps {
  layout?: 'menu' | 'hero'
}

const FILES = [
  {
    name: 'Brand assets',
    icon: Folder,
    size: '24.6 MB',
    type: 'Folder',
    created: 'Sep 4',
    owner: 'Morgan',
  },
  {
    name: 'Weekly report.pdf',
    icon: PdfIcon,
    size: '1.8 MB',
    type: 'PDF',
    created: 'Sep 4',
    owner: 'Morgan',
  },
  {
    name: 'Qualified leads.csv',
    icon: CsvIcon,
    size: '96 KB',
    type: 'CSV',
    created: 'Sep 4',
    owner: 'Alex',
  },
  {
    name: 'Product brief.docx',
    icon: DocxIcon,
    size: '324 KB',
    type: 'DOCX',
    created: 'Sep 3',
    owner: 'Jordan',
  },
  {
    name: 'Brand guidelines.pdf',
    icon: PdfIcon,
    size: '5.1 MB',
    type: 'PDF',
    created: 'Sep 2',
    owner: 'Morgan',
  },
] as const

/** A native Files resource list with the product’s file types and columns, without creation actions. */
export function FilesMenuPreview({ layout = 'menu' }: FilesMenuPreviewProps) {
  return (
    <MenuPreviewFrame kind='files' layout={layout}>
      <div className='w-[660px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] font-normal text-[13px] text-[var(--text-body)] shadow-xs'>
        <MenuPreviewHeader icon={Files} title='Files' />
        <MenuPreviewToolbar>
          <span className='mr-auto ml-2 flex items-center gap-2 text-[var(--text-muted)]'>
            <Search className='size-[14px]' />
            Search files...
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
            <col className='w-[256px]' />
            <col className='w-[78px]' />
            <col className='w-[98px]' />
            <col className='w-[94px]' />
            <col className='w-[132px]' />
          </colgroup>
          <thead>
            <tr className='h-9 border-[var(--border)] border-b text-[var(--text-muted)]'>
              <th className='pl-4 font-normal'>Name</th>
              <th className='font-normal'>Size</th>
              <th className='font-normal'>Type</th>
              <th className='font-normal'>Created</th>
              <th className='font-normal'>Owner</th>
            </tr>
          </thead>
          <tbody>
            {FILES.map(({ name, icon: Icon, size, type, created, owner }) => (
              <tr key={name} className='h-11 text-[var(--text-secondary)]'>
                <td className='pl-4 text-[var(--text-body)]'>
                  <span className='flex items-center gap-2.5'>
                    <Icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                    <span className='truncate'>{name}</span>
                  </span>
                </td>
                <td className='tabular-nums'>{size}</td>
                <td>
                  <span className='flex items-center gap-2'>
                    <Icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                    {type}
                  </span>
                </td>
                <td>{created}</td>
                <td>
                  <span className='flex items-center gap-2'>
                    <span className='flex size-[18px] items-center justify-center rounded-full bg-[var(--surface-3)] text-[10px]'>
                      {owner[0]}
                    </span>
                    {owner}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </MenuPreviewFrame>
  )
}
