import { getDocumentIcon } from '@/components/icons/document-icons'
import type { LibraryFile } from '@/app/(landing)/files/components/files-library-preview/data'

interface LibraryFileListProps {
  files: readonly LibraryFile[]
  onSelect: (id: string) => void
}

/** The Files resource's Name, Size, Type, Created, and Owner columns. */
export function LibraryFileList({ files, onSelect }: LibraryFileListProps) {
  return (
    <div className='min-h-0 flex-1 overflow-auto'>
      <table className='w-full min-w-[658px] table-fixed border-collapse whitespace-nowrap text-left text-small'>
        <colgroup>
          <col className='w-[256px]' />
          <col className='w-[78px]' />
          <col className='w-[98px]' />
          <col className='w-[94px]' />
          <col className='w-[132px]' />
        </colgroup>
        <thead>
          <tr className='h-9 border-[var(--border)] border-b text-[var(--text-secondary)]'>
            {['Name', 'Size', 'Type', 'Created', 'Owner'].map((name) => (
              <th key={name} className='font-normal first:pl-4'>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {files.map((file) => {
            const Icon = getDocumentIcon('', file.name)
            return (
              <tr
                key={file.id}
                className='h-11 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'
              >
                <td className='pl-4 text-[var(--text-body)]'>
                  <button
                    type='button'
                    onClick={() => onSelect(file.id)}
                    className='flex h-11 max-w-full items-center gap-2.5 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-[var(--text-primary)]'
                  >
                    <Icon
                      aria-hidden='true'
                      className='size-[14px] shrink-0 text-[var(--text-icon)]'
                    />
                    <span className='sr-only'>Open {file.type} </span>
                    <span className='truncate'>{file.name}</span>
                  </button>
                </td>
                <td className='tabular-nums'>{file.size}</td>
                <td>
                  <span className='flex items-center gap-2'>
                    <Icon
                      aria-hidden='true'
                      className='size-[14px] shrink-0 text-[var(--text-icon)]'
                    />
                    {file.type}
                  </span>
                </td>
                <td>{file.created}</td>
                <td>
                  <span className='flex items-center gap-2'>
                    <span className='flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--surface-3)] text-micro'>
                      {file.owner[0]}
                    </span>
                    <span className='truncate'>{file.owner}</span>
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {files.length === 0 && (
        <p role='status' className='p-6 text-[var(--text-secondary)] text-small'>
          No files match your search.
        </p>
      )}
    </div>
  )
}
