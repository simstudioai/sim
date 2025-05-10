import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PaginationProps {
  page: number
  totalItems: number
  itemsPerPage: number
  loading: boolean
  onFirstPage: () => void
  onPrevPage: () => void
  onNextPage: () => void
  onLastPage: () => void
}

export function Pagination({
  page,
  totalItems,
  itemsPerPage,
  loading,
  onFirstPage,
  onPrevPage,
  onNextPage,
  onLastPage,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage))

  return (
    <div className="flex items-center justify-center gap-1.5 my-3 pb-1">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onFirstPage}
          disabled={page === 1 || loading}
          title="First Page"
          className="h-8 w-8 p-0"
        >
          <ChevronsLeftIcon className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onPrevPage}
          disabled={page === 1 || loading}
          className="h-8 px-2 text-xs"
        >
          <ChevronLeftIcon className="h-3.5 w-3.5 mr-1" />
          Prev
        </Button>
      </div>

      <span className="text-xs text-muted-foreground mx-2">
        Page {page} of {totalPages}
        &nbsp;•&nbsp;
        {totalItems} total entries
      </span>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onNextPage}
          disabled={page >= totalPages || loading}
          className="h-8 px-2 text-xs"
        >
          Next
          <ChevronRightIcon className="h-3.5 w-3.5 ml-1" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onLastPage}
          disabled={page >= totalPages || loading}
          title="Last Page"
          className="h-8 w-8 p-0"
        >
          <ChevronsRightIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
