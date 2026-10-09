'use client'

import {
  Chip,
  ChipChevronDown,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { Folder, Upload, X } from '@sim/emcn/icons'

interface UploadMenuProps {
  label: string
  disabled: boolean
  uploading: boolean
  onFiles: () => void
  onFolder: () => void
  onCancel: () => void
}

/** Offers file and folder uploads, or cancellation while an upload is running. */
export function UploadMenu({
  label,
  disabled,
  uploading,
  onFiles,
  onFolder,
  onCancel,
}: UploadMenuProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Chip leftIcon={Upload} rightAdornment={<ChipChevronDown />} disabled={disabled}>
          {label}
        </Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        {uploading ? (
          <DropdownMenuItem onSelect={onCancel}>
            <X />
            Cancel upload
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={onFiles}>
              <Upload />
              Upload files
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onFolder}>
              <Folder />
              Upload folder
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
