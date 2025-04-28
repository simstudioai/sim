import {
  UserIcon,
  UserCheckIcon, 
  UserXIcon,
  CheckIcon
} from 'lucide-react'
import { FilterButton } from './components/filter-button'

interface FilterBarProps {
  currentStatus: string
  onStatusChange: (status: string) => void
}

export function FilterBar({ currentStatus, onStatusChange }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <FilterButton
        active={currentStatus === 'all'}
        onClick={() => onStatusChange('all')}
        icon={<UserIcon className="h-3.5 w-3.5" />}
        label="All"
        className={
          currentStatus === 'all'
            ? 'bg-blue-100 text-blue-900 hover:bg-blue-200 hover:text-blue-900'
            : ''
        }
      />
      <FilterButton
        active={currentStatus === 'pending'}
        onClick={() => onStatusChange('pending')}
        icon={<UserIcon className="h-3.5 w-3.5" />}
        label="Pending"
        className={
          currentStatus === 'pending'
            ? 'bg-amber-100 text-amber-900 hover:bg-amber-200 hover:text-amber-900'
            : ''
        }
      />
      <FilterButton
        active={currentStatus === 'approved'}
        onClick={() => onStatusChange('approved')}
        icon={<UserCheckIcon className="h-3.5 w-3.5" />}
        label="Approved"
        className={
          currentStatus === 'approved'
            ? 'bg-green-100 text-green-900 hover:bg-green-200 hover:text-green-900'
            : ''
        }
      />
      <FilterButton
        active={currentStatus === 'rejected'}
        onClick={() => onStatusChange('rejected')}
        icon={<UserXIcon className="h-3.5 w-3.5" />}
        label="Rejected"
        className={
          currentStatus === 'rejected'
            ? 'bg-red-100 text-red-900 hover:bg-red-200 hover:text-red-900'
            : ''
        }
      />
      <FilterButton
        active={currentStatus === 'signed_up'}
        onClick={() => onStatusChange('signed_up')}
        icon={<CheckIcon className="h-3.5 w-3.5" />}
        label="Signed Up"
        className={
          currentStatus === 'signed_up'
            ? 'bg-purple-100 text-purple-900 hover:bg-purple-200 hover:text-purple-900'
            : ''
        }
      />
    </div>
  )
} 