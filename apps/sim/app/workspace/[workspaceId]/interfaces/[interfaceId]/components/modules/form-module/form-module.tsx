'use client'

import { useState } from 'react'
import { Chip } from '@sim/emcn'
import { CircleCheck, FormInput } from '@sim/emcn/icons'
import { isApiClientError } from '@/lib/api/client/errors'
import type { SubmitInterfaceFormValues } from '@/lib/api/contracts/interfaces'
import type { FormField, FormSubmissionFieldError, InterfaceModule } from '@/lib/interfaces'
import { validateFormSubmission } from '@/lib/interfaces/form-submission'
import { FormFieldControl } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/modules/form-module/components/form-field-control'
import { ModuleEmptyState } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/modules/module-empty-state'
import type { InterfaceMode } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/search-params'
import { useSubmitInterfaceForm } from '@/hooks/queries/interfaces'

/** Values the visitor has entered, keyed by field id. Unset fields fall back to their default. */
type FormValues = Record<string, string | boolean>

/** Per-field messages keyed by field id; `undefined` means the field is clean. */
type FieldErrors = Record<string, string | undefined>

/**
 * The value a field starts at. A dropdown default that no longer matches an
 * option is ignored — submitting it would be rejected, and the builder can
 * leave one behind by editing options after setting the default.
 */
function defaultFieldValue(field: FormField): string | boolean {
  if (field.type === 'switch') {
    return field.defaultValue === true
  }
  if (typeof field.defaultValue !== 'string') return ''
  if (field.type === 'dropdown' && !field.options?.includes(field.defaultValue)) return ''
  return field.defaultValue
}

function fieldValue(field: FormField, values: FormValues): string | boolean {
  const entered = values[field.id]
  return entered === undefined ? defaultFieldValue(field) : entered
}

function toFieldErrors(errors: readonly FormSubmissionFieldError[]): FieldErrors {
  const map: FieldErrors = {}
  for (const error of errors) {
    if (map[error.fieldId] === undefined) map[error.fieldId] = error.message
  }
  return map
}

/**
 * Pulls the typed per-field errors out of the submit route's 400 body
 * (`{ error, details: FormSubmissionFieldError[] }`). Those details carry a
 * `fieldId` rather than a Zod `path`, so `extractValidationIssues` does not
 * recognise them.
 */
function extractServerFieldErrors(error: unknown): FieldErrors | null {
  if (!isApiClientError(error)) return null
  const body = error.body
  if (!body || typeof body !== 'object') return null
  const details = (body as { details?: unknown }).details
  if (!Array.isArray(details)) return null

  const map: FieldErrors = {}
  for (const detail of details) {
    if (!detail || typeof detail !== 'object') continue
    const { fieldId, message } = detail as { fieldId?: unknown; message?: unknown }
    if (typeof fieldId !== 'string' || typeof message !== 'string') continue
    if (map[fieldId] === undefined) map[fieldId] = message
  }
  return Object.keys(map).length > 0 ? map : null
}

export interface FormModuleProps {
  workspaceId: string
  interfaceId: string
  module: Extract<InterfaceModule, { type: 'form' }>
  /** 'edit' → controls render but submit is disabled. 'preview' → live. */
  mode: InterfaceMode
  /**
   * Whether the viewer may run the form. Submitting without it is rejected by
   * the submit route, so the action is disabled rather than left live.
   */
  canEdit?: boolean
}

/**
 * Renders a form module's fields and runs its connected workflow on submit.
 * Entered values are ephemeral local state — nothing is persisted, and the
 * form resets to its defaults once a run is accepted.
 */
export function FormModule({
  workspaceId,
  interfaceId,
  module,
  mode,
  canEdit = true,
}: FormModuleProps) {
  const [values, setValues] = useState<FormValues>({})
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  /**
   * A rejection that no rendered field can show — the visitor's cached field
   * list is up to 30s behind the builder's, so the server can reject a field id
   * this render knows nothing about.
   */
  const [unrenderedError, setUnrenderedError] = useState<string | null>(null)
  const submitForm = useSubmitInterfaceForm(workspaceId)

  const { fields, submitLabel, workflowId } = module.config
  const isEditMode = mode === 'edit'

  if (workflowId === null) {
    return (
      <ModuleEmptyState
        icon={FormInput}
        message={
          isEditMode ? 'Connect a workflow to run this form.' : 'This form is not available.'
        }
      />
    )
  }
  if (fields.length === 0) {
    return (
      <ModuleEmptyState
        icon={FormInput}
        message={isEditMode ? 'Add fields in the properties panel.' : 'This form is not available.'}
      />
    )
  }

  const isSubmitDisabled = isEditMode || !canEdit
  /** Only errors a rendered control can show count as "handled inline". */
  const hasFieldErrors = fields.some((field) => fieldErrors[field.id] !== undefined)
  const formError = submitForm.isError
    ? (unrenderedError ?? (hasFieldErrors ? null : submitForm.error.message))
    : null

  function handleValueChange(fieldId: string, next: string | boolean): void {
    setValues((previous) => ({ ...previous, [fieldId]: next }))
    setFieldErrors((previous) =>
      previous[fieldId] === undefined ? previous : { ...previous, [fieldId]: undefined }
    )
    setUnrenderedError(null)
    if (submitForm.isSuccess || submitForm.isError) submitForm.reset()
  }

  function handleSubmit(): void {
    const payload: SubmitInterfaceFormValues = {}
    for (const field of fields) {
      payload[field.id] = fieldValue(field, values)
    }

    setUnrenderedError(null)

    const validation = validateFormSubmission(fields, payload)
    if (!validation.valid) {
      setFieldErrors(toFieldErrors(validation.errors))
      return
    }

    setFieldErrors({})
    submitForm.mutate(
      { interfaceId, moduleId: module.id, values: payload },
      {
        onSuccess: () => setValues({}),
        onError: (error) => {
          const serverErrors = extractServerFieldErrors(error)
          if (!serverErrors) return

          const renderedIds = new Set(fields.map((field) => field.id))
          const rendered: FieldErrors = {}
          let unrendered: string | null = null
          for (const [fieldId, message] of Object.entries(serverErrors)) {
            if (message === undefined) continue
            if (renderedIds.has(fieldId)) rendered[fieldId] = message
            else unrendered ??= message
          }
          setFieldErrors(rendered)
          setUnrenderedError(unrendered)
        },
      }
    )
  }

  return (
    <form
      className='flex h-full min-h-0 flex-col'
      onSubmit={(event) => {
        event.preventDefault()
        handleSubmit()
      }}
    >
      <div className='min-h-0 flex-1 overflow-y-auto p-4'>
        <div className='flex flex-col gap-4'>
          {fields.map((field) => (
            <FormFieldControl
              key={field.id}
              field={field}
              value={fieldValue(field, values)}
              onChange={(next) => handleValueChange(field.id, next)}
              error={fieldErrors[field.id]}
              disabled={submitForm.isPending}
            />
          ))}
        </div>
      </div>

      <div className='flex shrink-0 items-center justify-between gap-3 border-[var(--border)] border-t px-4 py-3'>
        <div className='min-w-0 flex-1'>
          {formError ? (
            <p role='alert' className='text-[var(--text-error)] text-caption'>
              {formError}
            </p>
          ) : submitForm.isSuccess ? (
            <p className='flex items-center gap-1.5 text-[var(--text-muted)] text-caption'>
              <CircleCheck className='size-[14px] shrink-0 text-[var(--text-success)]' />
              Submitted
            </p>
          ) : isEditMode ? (
            <p className='text-[var(--text-muted)] text-caption'>Switch to preview to submit.</p>
          ) : !canEdit ? (
            <p className='text-[var(--text-muted)] text-caption'>
              You need edit access to submit this form.
            </p>
          ) : null}
        </div>
        <Chip
          type='submit'
          variant='primary'
          flush
          disabled={isSubmitDisabled || submitForm.isPending}
          className='shrink-0'
        >
          {submitForm.isPending ? 'Submitting…' : submitLabel}
        </Chip>
      </div>
    </form>
  )
}
