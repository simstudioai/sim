'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/core/utils/cn'

/**
 * Variant styles for the Table component.
 * Controls layout, sizing, and density.
 *
 * @example
 * ```tsx
 * // Default table
 * <Table>...</Table>
 *
 * // Fixed layout with small text
 * <Table layout="fixed" size="sm">...</Table>
 *
 * // Compact density
 * <Table density="compact">...</Table>
 * ```
 */
const tableVariants = cva('w-full caption-bottom', {
  variants: {
    layout: {
      auto: '',
      fixed: 'table-fixed',
    },
    size: {
      sm: 'text-[12px]',
      md: 'text-[13px]',
      lg: 'text-[14px]',
    },
  },
  defaultVariants: {
    layout: 'auto',
    size: 'md',
  },
})

/**
 * Variant styles for TableRow component.
 * Controls hover behavior and interactive states.
 */
const tableRowVariants = cva('border-b border-[var(--border)] transition-colors', {
  variants: {
    hover: {
      default: 'hover:bg-[var(--surface-2)]/50',
      surface: 'hover:bg-[var(--surface-2)]',
      none: 'hover:bg-transparent',
    },
    interactive: {
      true: 'cursor-pointer',
      false: '',
    },
    selected: {
      true: 'bg-[var(--surface-2)]',
      false: '',
    },
  },
  defaultVariants: {
    hover: 'default',
    interactive: false,
    selected: false,
  },
})

/**
 * Variant styles for TableCell and TableHead components.
 * Controls padding density.
 */
const tableCellVariants = cva('align-middle', {
  variants: {
    density: {
      compact: 'px-[8px] py-[4px]',
      default: 'px-[12px] py-[8px]',
      relaxed: 'px-[16px] py-[12px]',
    },
  },
  defaultVariants: {
    density: 'default',
  },
})

export interface TableProps
  extends React.HTMLAttributes<HTMLTableElement>,
    VariantProps<typeof tableVariants> {}

/**
 * A flexible Table component with variant support.
 *
 * @example
 * ```tsx
 * <Table layout="fixed" size="sm">
 *   <TableHeader>
 *     <TableRow hover="none">
 *       <TableHead>Name</TableHead>
 *       <TableHead>Status</TableHead>
 *     </TableRow>
 *   </TableHeader>
 *   <TableBody>
 *     <TableRow hover="surface" interactive>
 *       <TableCell>Document.pdf</TableCell>
 *       <TableCell>Active</TableCell>
 *     </TableRow>
 *   </TableBody>
 * </Table>
 * ```
 */
const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, layout, size, ...props }, ref) => (
    <div className='relative w-full overflow-auto'>
      <table ref={ref} className={cn(tableVariants({ layout, size }), className)} {...props} />
    </div>
  )
)
Table.displayName = 'Table'

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />
))
TableHeader.displayName = 'TableHeader'

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
))
TableBody.displayName = 'TableBody'

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      'border-t bg-[var(--surface-2)]/50 font-medium [&>tr]:last:border-b-0',
      className
    )}
    {...props}
  />
))
TableFooter.displayName = 'TableFooter'

export interface TableRowProps
  extends React.HTMLAttributes<HTMLTableRowElement>,
    VariantProps<typeof tableRowVariants> {}

const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, hover, interactive, selected, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(tableRowVariants({ hover, interactive, selected }), className)}
      data-state={selected ? 'selected' : undefined}
      {...props}
    />
  )
)
TableRow.displayName = 'TableRow'

export interface TableHeadProps
  extends React.ThHTMLAttributes<HTMLTableCellElement>,
    VariantProps<typeof tableCellVariants> {}

const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, density, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        tableCellVariants({ density }),
        'h-10 text-left font-medium text-[var(--text-secondary)] [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className
      )}
      {...props}
    />
  )
)
TableHead.displayName = 'TableHead'

export interface TableCellProps
  extends React.TdHTMLAttributes<HTMLTableCellElement>,
    VariantProps<typeof tableCellVariants> {}

const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, density, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        tableCellVariants({ density }),
        '[&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className
      )}
      {...props}
    />
  )
)
TableCell.displayName = 'TableCell'

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn('mt-4 text-[var(--text-muted)] text-sm', className)}
    {...props}
  />
))
TableCaption.displayName = 'TableCaption'

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  tableVariants,
  tableRowVariants,
  tableCellVariants,
}
