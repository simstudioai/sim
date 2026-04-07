import { Skeleton } from '@/components/emcn'

const SKELETON_ROW_COUNT = 8
const COLUMN_COUNT = 5

export default function TableDetailLoading() {
  return (
    <div className='flex h-full flex-1 flex-col overflow-hidden bg-[var(--bg)]'>
      <div className='border-[var(--border)] border-b px-[16px] py-[8.5px]'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-[8px]'>
            <Skeleton className='h-[14px] w-[14px] rounded-[2px]' />
            <Skeleton className='h-[14px] w-[44px] rounded-[4px]' />
            <Skeleton className='h-[14px] w-[8px] rounded-[2px]' />
            <Skeleton className='h-[14px] w-[100px] rounded-[4px]' />
          </div>
          <div className='flex items-center gap-[6px]'>
            <Skeleton className='h-[28px] w-[80px] rounded-[6px]' />
          </div>
        </div>
      </div>
      <div className='min-h-0 flex-1 overflow-auto'>
        <table className='w-full'>
          <thead>
            <tr className='border-[var(--border)] border-b'>
              {Array.from({ length: COLUMN_COUNT }).map((_, i) => (
                <th key={i} className='px-[12px] py-[8px] text-left'>
                  <Skeleton className='h-[12px] w-[72px] rounded-[4px]' />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: SKELETON_ROW_COUNT }).map((_, rowIndex) => (
              <tr key={rowIndex} className='border-[var(--border)] border-b'>
                {Array.from({ length: COLUMN_COUNT }).map((_, colIndex) => (
                  <td key={colIndex} className='px-[12px] py-[10px]'>
                    <Skeleton
                      className='h-[14px] rounded-[4px]'
                      style={{ width: `${80 + (colIndex % 3) * 40}px` }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
