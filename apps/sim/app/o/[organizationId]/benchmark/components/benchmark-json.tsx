'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import type { BenchmarkCase } from '@/lib/api/contracts/benchmarks'
import { validateBenchmarkRedaction } from '@/lib/benchmarks/artifacts'
import { benchmarkArtifactsSchema } from '@/lib/benchmarks/types'

interface BenchmarkJsonProps {
  artifacts: BenchmarkCase['artifacts']
  disabled: boolean
  onApply: (patch: Pick<BenchmarkCase['artifacts'], 'redactedSpec' | 'blanks'>) => void
  onClose: () => void
}

export function BenchmarkJson({ artifacts, disabled, onApply, onClose }: BenchmarkJsonProps) {
  const [redactedSpec, setRedactedSpec] = useState(
    artifacts.redactedSpec || artifacts.referenceSpec
  )
  const [mapping, setMapping] = useState(() =>
    JSON.stringify(
      Object.fromEntries(artifacts.blanks.map(({ id, answer }) => [id, answer])),
      null,
      2
    )
  )
  const [error, setError] = useState<string | null>(null)

  const apply = () => {
    if (disabled) return
    try {
      let value: unknown
      try {
        value = JSON.parse(mapping)
      } catch {
        throw new Error('Enter valid JSON, such as {"queue": "Customer Escalations"}.')
      }
      if (!isRecordLike(value)) {
        throw new Error('Use a JSON object mapping blank IDs to their exact answers.')
      }
      const parsed = benchmarkArtifactsSchema.shape.blanks.safeParse(
        Object.entries(value).map(([id, answer]) => ({ id, answer }))
      )
      if (!parsed.success) {
        throw new Error(
          'Use blank IDs with letters, numbers, underscores or hyphens (at most 64 characters), each mapped to a nonempty answer string.'
        )
      }
      const patch = { redactedSpec, blanks: parsed.data }
      validateBenchmarkRedaction({ referenceSpec: artifacts.referenceSpec, ...patch })
      onApply(patch)
      onClose()
    } catch (error) {
      setError(getErrorMessage(error, 'Could not apply the JSON mapping'))
    }
  }

  return (
    <ChipModal
      open
      onOpenChange={(open) => !open && onClose()}
      size='xl'
      srTitle='Edit blanks as JSON'
    >
      <ChipModalHeader onClose={onClose}>Edit blanks as JSON</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='textarea'
          title='Redacted reference'
          value={redactedSpec}
          onChange={(value) => {
            setRedactedSpec(value)
            setError(null)
          }}
          rows={6}
          resizable
          disabled={disabled}
          hint='Use [[BLANK:id]] for each answer to recover.'
        />
        <ChipModalField
          type='textarea'
          title='Expected answers (JSON)'
          value={mapping}
          onChange={(value) => {
            setMapping(value)
            setError(null)
          }}
          placeholder={
            '{\n  "queue": "Customer Escalations",\n  "handoff": "Engineering explicitly accepts the case"\n}'
          }
          rows={10}
          mono
          resizable
          disabled={disabled}
          error={error}
          hint='Map each blank ID to its exact original text. Applying updates the editable draft; save changes afterward.'
        />
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        primaryAction={{ label: 'Apply mapping', onClick: apply, disabled }}
      />
    </ChipModal>
  )
}
