import type { ReactNode } from 'react'

interface CommandTableProps {
  children: ReactNode
}

/** Long CLI flags keep an intentional measure while the table scrolls within its article. */
export function CommandTable({ children }: CommandTableProps) {
  return (
    <div className='min-w-0 [&_table]:min-w-[560px] [&_table]:table-fixed [&_td:first-child_code]:break-words [&_td]:align-top [&_th:nth-child(1)]:w-[30%] [&_th:nth-child(2)]:w-[5.5rem]'>
      {children}
    </div>
  )
}
