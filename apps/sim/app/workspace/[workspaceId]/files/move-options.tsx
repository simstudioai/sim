import type { ReactNode } from 'react'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/emcn'
import { Folder } from '@/components/emcn/icons'

export interface MoveOptionNode {
  value: string
  label: string
  children: MoveOptionNode[]
}

export function renderMoveOption(
  option: MoveOptionNode,
  onMove: (value: string) => void
): ReactNode {
  if (option.children.length === 0) {
    return (
      <DropdownMenuItem key={option.value} onSelect={() => onMove(option.value)}>
        <Folder />
        {option.label}
      </DropdownMenuItem>
    )
  }
  return (
    <DropdownMenuSub key={option.value}>
      <DropdownMenuSubTrigger>
        <Folder />
        {option.label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem onSelect={() => onMove(option.value)}>Move here</DropdownMenuItem>
        <DropdownMenuSeparator />
        {option.children.map((child) => renderMoveOption(child, onMove))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
