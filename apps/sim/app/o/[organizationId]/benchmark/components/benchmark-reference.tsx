'use client'

import { useRef, useState } from 'react'
import { Chip, ChipTextarea, toast } from '@sim/emcn'
import { Code, Upload } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import type { BenchmarkCase, RunBenchmarkStageBody } from '@/lib/api/contracts/benchmarks'
import { BenchmarkJson } from '@/app/o/[organizationId]/benchmark/components/benchmark-json'
import { BenchmarkStep } from '@/app/o/[organizationId]/benchmark/components/benchmark-step'

interface BenchmarkReferenceProps {
  artifacts: BenchmarkCase['artifacts']
  busy: boolean
  saving: boolean
  stage: RunBenchmarkStageBody['stage'] | null
  referenceDirty: boolean
  redactionDirty: boolean
  onChange: (patch: Partial<BenchmarkCase['artifacts']>) => void
  onSave: () => void
  onRun: (stage: RunBenchmarkStageBody['stage']) => void
}

export function BenchmarkReference({
  artifacts,
  busy,
  saving,
  stage,
  referenceDirty,
  redactionDirty,
  onChange,
  onSave,
  onRun,
}: BenchmarkReferenceProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [jsonOpen, setJsonOpen] = useState(false)
  const dirty = referenceDirty || redactionDirty
  const { taskBrief, referenceSpec, redactedSpec, blanks } = artifacts

  const importReference = async (file: File | undefined) => {
    if (!file) return
    try {
      const text = await file.text()
      onChange({ referenceSpec: text })
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not import the reference'))
    }
  }

  return (
    <BenchmarkStep
      number={1}
      title='Prepare the reference'
      description='Generate a reference from the completed workspace, or paste one from another client. Review the brief and the details to recover.'
      pending={stage === 'distill' || stage === 'redact'}
      action={
        <Chip disabled={busy || dirty} onClick={() => onRun('distill')}>
          {stage === 'distill'
            ? 'Generating…'
            : referenceSpec
              ? 'Regenerate reference'
              : 'Generate reference'}
        </Chip>
      }
    >
      <fieldset disabled={busy || redactionDirty} className='flex min-w-0 flex-col gap-4'>
        <div className='flex flex-col gap-1.5'>
          <label htmlFor='reference-task-brief' className='text-[var(--text-body)] text-small'>
            Task brief
          </label>
          <ChipTextarea
            id='reference-task-brief'
            value={taskBrief}
            onChange={(event) => onChange({ taskBrief: event.target.value })}
            placeholder='What should the new Mothership plan?'
            rows={4}
            resizable
          />
          <p className='text-[var(--text-muted)] text-small'>
            The planner receives this request and discovers the details through the selected user’s
            enterprise sources.
          </p>
        </div>
        <div className='flex flex-col gap-1.5'>
          <div className='flex items-center justify-between gap-2'>
            <label htmlFor='reference-spec' className='text-[var(--text-body)] text-small'>
              Reference spec
            </label>
            <Chip leftIcon={Upload} onClick={() => fileInput.current?.click()}>
              Import spec
            </Chip>
            <input
              ref={fileInput}
              type='file'
              accept='.md,.txt,.json,text/plain,text/markdown,application/json'
              className='hidden'
              aria-label='Import reference spec'
              onChange={(event) => {
                void importReference(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </div>
          <ChipTextarea
            id='reference-spec'
            value={referenceSpec}
            onChange={(event) => onChange({ referenceSpec: event.target.value })}
            placeholder='Generate a spec, paste one, or import Markdown, text, or JSON.'
            rows={12}
            resizable
          />
        </div>
      </fieldset>

      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-[var(--text-body)] text-small'>
          Redacted reference and expected answers
        </p>
        <div className='flex flex-wrap items-center gap-1'>
          <Chip
            leftIcon={Code}
            disabled={busy || referenceDirty || !referenceSpec.trim()}
            onClick={() => {
              onChange({})
              setJsonOpen(true)
            }}
          >
            Edit JSON
          </Chip>
          <Chip disabled={busy || dirty || !referenceSpec.trim()} onClick={() => onRun('redact')}>
            {stage === 'redact'
              ? 'Redacting…'
              : redactedSpec
                ? 'Regenerate blanks with AI'
                : 'Generate blanks with AI'}
          </Chip>
        </div>
      </div>
      <p className='text-[var(--text-muted)] text-small'>
        Let AI generate the redacted reference and answers, or paste your own JSON answer mapping.
      </p>
      {jsonOpen && (
        <BenchmarkJson
          artifacts={artifacts}
          disabled={busy || referenceDirty}
          onApply={onChange}
          onClose={() => setJsonOpen(false)}
        />
      )}
      {(redactedSpec || blanks.length > 0) && (
        <fieldset disabled={busy || referenceDirty} className='flex min-w-0 flex-col gap-4'>
          <ChipTextarea
            aria-label='Redacted reference spec'
            value={redactedSpec}
            readOnly
            rows={10}
            resizable
          />
          <p className='text-[var(--text-muted)] text-small'>
            Each marker uses [[BLANK:id]], and its expected answer must restore the exact original
            passage. Keep discoverable details and remove answers revealed elsewhere in the text.
          </p>
          <dl className='flex flex-col gap-3'>
            {blanks.map((blank) => (
              <div key={blank.id} className='flex flex-col gap-1'>
                <dt className='text-[var(--text-body)] text-small'>{blank.id}</dt>
                <dd className='whitespace-pre-wrap text-[var(--text-muted)] text-small'>
                  {blank.answer}
                </dd>
              </div>
            ))}
          </dl>
          <p className='text-[var(--text-muted)] text-small'>
            Use Edit JSON to change markers and answers together. Changes are checked against the
            original reference before applying.
          </p>
        </fieldset>
      )}
      {dirty && (
        <div className='flex flex-wrap items-center gap-3'>
          <Chip variant='primary' disabled={busy} onClick={onSave}>
            {saving ? 'Saving…' : 'Save changes'}
          </Chip>
          <p className='text-[var(--text-muted)] text-small'>
            {referenceDirty
              ? 'Changing the brief or reference clears the later results.'
              : 'Changing the blanks clears reconstruction and grading.'}
          </p>
        </div>
      )}
    </BenchmarkStep>
  )
}
