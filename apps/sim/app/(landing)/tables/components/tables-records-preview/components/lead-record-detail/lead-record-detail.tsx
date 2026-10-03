import { useState } from 'react'
import {
  ChipDropdown,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { TagIcon, TypeNumber, TypeText } from '@sim/emcn/icons'
import type { LeadRecord } from '@/app/(landing)/tables/components/tables-records-preview/data'

interface LeadRecordDetailProps {
  record: LeadRecord
  onClose: () => void
  onSave: (record: LeadRecord) => void
}

/** Uses the production row-modal's title, field chrome, and Update Row action with local data. */
export function LeadRecordDetail({ record, onClose, onSave }: LeadRecordDetailProps) {
  const [draft, setDraft] = useState(record)
  return (
    <ChipModal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      srTitle='Edit Row'
      size='lg'
    >
      <ChipModalHeader onClose={onClose}>Edit Row</ChipModalHeader>
      <ChipModalBody>
        <p className='px-2 text-[var(--text-secondary)] text-small'>
          Update values for Qualified leads
        </p>
        <ChipModalField
          type='input'
          title={
            <span className='flex items-center gap-1.5'>
              <TypeText className='size-[14px]' />
              Company
            </span>
          }
          value={draft.company}
          onChange={(company) => setDraft((current) => ({ ...current, company }))}
        />
        <ChipModalField
          type='input'
          inputType='number'
          title={
            <span className='flex items-center gap-1.5'>
              <TypeNumber className='size-[14px]' />
              Score
            </span>
          }
          value={String(draft.score)}
          onChange={(score) => setDraft((current) => ({ ...current, score: Number(score) }))}
        />
        <ChipModalField
          type='custom'
          title={
            <span className='flex items-center gap-1.5'>
              <TagIcon className='size-[14px]' />
              Status
            </span>
          }
        >
          <ChipDropdown
            value={draft.status}
            options={[
              { value: 'Qualified', label: 'Qualified' },
              { value: 'Review', label: 'Review' },
            ]}
            onChange={(status) => {
              if (status === 'Qualified' || status === 'Review')
                setDraft((current) => ({ ...current, status }))
            }}
          />
        </ChipModalField>
        <ChipModalField
          type='input'
          title={
            <span className='flex items-center gap-1.5'>
              <TypeText className='size-[14px]' />
              Contact
            </span>
          }
          value={draft.contact}
          onChange={(contact) => setDraft((current) => ({ ...current, contact }))}
        />
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        primaryAction={{
          label: 'Update Row',
          onClick: () => onSave(draft),
          disabled: !draft.company.trim() || !Number.isFinite(draft.score),
        }}
      />
    </ChipModal>
  )
}
