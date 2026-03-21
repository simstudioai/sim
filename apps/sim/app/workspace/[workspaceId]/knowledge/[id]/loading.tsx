import { Skeleton } from '@/components/emcn'

const SKELETON_ROW_COUNT = 5
const COLUMN_COUNT = 7

export default function KnowledgeBaseLoading() {
  return (
    <div className='flex h-full flex-1 flex-col overflow-hidden bg-[var(--bg)]'>
      <div className='border-[var(--border)] border-b px-[16px] py-[8.5px]'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-[8px]'>
            <Skeleton className='h-[14px] w-[14px] rounded-[2px]' />
            <Skeleton className='h-[14px] w-[96px] rounded-[4px]' />
            <Skeleton className='h-[14px] w-[8px] rounded-[2px]' />
            <Skeleton className='h-[14px] w-[120px] rounded-[4px]' />
          </div>
          <div className='flex items-center gap-[6px]'>
            <Skeleton className='h-[28px] w-[112px] rounded-[6px]' />
          </div>
        </div>
      </div>
      <div className='border-[var(--border)] border-b px-[24px] py-[10px]'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center'>
            <Skeleton className='h-[14px] w-[14px] rounded-[2px]' />
            <Skeleton className='ml-[10px] h-[14px] w-[140px] rounded-[4px]' />
          </div>
          <div className='flex items-center gap-[6px]'>
            <Skeleton className='h-[28px] w-[56px] rounded-[6px]' />
            <Skeleton className='h-[28px] w-[56px] rounded-[6px]' />
          </div>
        </div>
      </div>
      <div className='min-h-0 flex-1 overflow-auto'>
        <table className='w-full'>
          <thead>
            <tr className='border-[var(--border)] border-b'>
              <th className='w-[40px] px-[12px] py-[8px]'>
                <Skeleton className='h-[14px] w-[14px] rounded-[2px]' />
              </th>
              {Array.from({ length: COLUMN_COUNT }).map((_, i) => (
                <th key={i} className='px-[12px] py-[8px] text-left'>
                  <Skeleton className='h-[12px] w-[56px] rounded-[4px]' />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: SKELETON_ROW_COUNT }).map((_, rowIndex) => (
              <tr key={rowIndex} className='border-[var(--border)] border-b'>
                <td className='w-[40px] px-[12px] py-[10px]'>
                  <Skeleton className='h-[14px] w-[14px] rounded-[2px]' />
                </td>
                {Array.from({ length: COLUMN_COUNT }).map((_, colIndex) => (
                  <td key={colIndex} className='px-[12px] py-[10px]'>
                    <Skeleton
                      className='h-[14px] rounded-[4px]'
                      style={{ width: colIndex === 0 ? '128px' : '80px' }}
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
