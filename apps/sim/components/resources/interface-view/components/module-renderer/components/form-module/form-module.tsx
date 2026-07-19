'use client'

import { useCallback, useState } from 'react'
import { Chip, cn } from '@sim/emcn'
import { CircleCheck, FormInput, Plus } from '@sim/emcn/icons'
import { generateId } from '@sim/utils/id'
import { ModuleChooser } from '@/components/resources/interface-view/components/module-chooser'
import { FormFieldControl } from '@/components/resources/interface-view/components/module-renderer/components/form-module/components/form-field-control'
import { useModuleFormSubmit } from '@/components/resources/interface-view/components/module-renderer/components/form-module/hooks/use-module-form-submit'
import { ModuleResourcePicker } from '@/components/resources/interface-view/components/module-renderer/components/module-resource-picker'
import { MODULE_GUTTER_X } from '@/components/resources/interface-view/module-chrome'
import { ResourceEmptyState } from '@/components/resources/resource-empty-state'
import { useResourceOfKind } from '@/components/resources/resource-provider'
import { isApiClientError } from '@/lib/api/client/errors'
import type { SubmitInterfaceFormValues } from '@/lib/api/contracts/interfaces'
import { INTERFACE_LAYOUT_LIMITS } from '@/lib/interfaces/constants'
import { isFormConfigValid } from '@/lib/interfaces/form-config'
import type { FormSubmissionFieldError } from '@/lib/interfaces/form-submission'
import { validateFormSubmission } from '@/lib/interfaces/form-submission'
import type {
  FormField,
  FormModuleConfig,
  InterfaceMode,
  InterfaceModule,
} from '@/lib/interfaces/types'
import { reorderList, useDragReorder } from '@/hooks/use-drag-reorder'

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

/**
 * Builds the next field with a name no existing field has taken. Field ids are
 * wire keys for submitted values, so they must be stable and unique.
 *
 * Mirrors the inspector's own factory: both authoring surfaces mint the same
 * field, so adding one on the canvas and adding one in the panel cannot
 * disagree.
 */
function createFormField(existing: readonly FormField[]): FormField {
  const taken = new Set(existing.map((field) => field.name.toLowerCase()))
  let index = existing.length + 1
  while (taken.has(`field_${index}`)) index += 1
  return {
    id: generateId(),
    name: `field_${index}`,
    label: `Field ${index}`,
    type: 'short-text',
    required: false,
  }
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
  module: Extract<InterfaceModule, { type: 'form' }>
  /** 'edit' → controls render but submit is disabled. 'preview' → live. */
  mode: InterfaceMode
  /**
   * Whether this surface is live for the viewer. Submitting without it is
   * rejected by the submit route, so the action is disabled rather than left
   * live.
   */
  canRun?: boolean
  /** Present only where this module may author itself — see `ModuleRenderer`. */
  onConfigChange?: (moduleId: string, config: InterfaceModule['config'], isValid: boolean) => void
}

/**
 * Renders a form module's fields and runs its connected workflow on submit.
 * Entered values are ephemeral local state — nothing is persisted, and the
 * form resets to its defaults once a run is accepted.
 *
 * The submission goes through {@link useModuleFormSubmit}, which picks the
 * workspace or token-scoped route from the surrounding resource; both
 * validate against the stored field definitions, so the inline per-field errors
 * below behave identically on a public share.
 *
 * Given `onConfigChange` the module authors itself: it binds its workflow from
 * the same chooser column the empty cell offered, and its fields grow, reorder,
 * and get renamed in place. The builder edits the form where the form is, at
 * the size a visitor will meet it. Everything a rendered field does *not* show
 * — type, name, placeholder, hint, required, options, default — stays in the
 * inspector, which carries all of it.
 */
export function FormModule({ module, mode, canRun = true, onConfigChange }: FormModuleProps) {
  const [values, setValues] = useState<FormValues>({})
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  /**
   * A rejection that no rendered field can show — the visitor's cached field
   * list is up to 30s behind the builder's, so the server can reject a field id
   * this render knows nothing about.
   */
  const [unrenderedError, setUnrenderedError] = useState<string | null>(null)
  const submitForm = useModuleFormSubmit(module.id)
  const { source } = useResourceOfKind('interface')

  const { fields, submitLabel, workflowId } = module.config
  const isEditMode = mode === 'edit'
  /** Authoring is edit mode plus write access — `onConfigChange` already means both. */
  const authoring = isEditMode ? onConfigChange : undefined

  /** Emits a config edit along with whether the result is safe to persist. */
  function updateConfig(patch: Partial<FormModuleConfig>): void {
    if (!authoring) return
    const next: FormModuleConfig = { ...module.config, ...patch }
    authoring(module.id, next, isFormConfigValid(next))
  }

  function handleAddField(): void {
    if (fields.length >= INTERFACE_LAYOUT_LIMITS.MAX_FORM_FIELDS) return
    updateConfig({ fields: [...fields, createFormField(fields)] })
  }

  function handleFieldLabelChange(index: number, label: string): void {
    updateConfig({ fields: fields.map((field, i) => (i === index ? { ...field, label } : field)) })
  }

  function handleFieldRemove(index: number): void {
    updateConfig({ fields: fields.filter((_, i) => i !== index) })
  }

  /**
   * Stable identity so the drag hook's per-row handlers stay put across the
   * re-render every keystroke in a label triggers.
   */
  const handleFieldReorder = useCallback(
    (from: number, to: number) => {
      const next: FormModuleConfig = {
        ...module.config,
        fields: reorderList(module.config.fields, from, to),
      }
      onConfigChange?.(module.id, next, isFormConfigValid(next))
    },
    [module.id, module.config, onConfigChange]
  )

  const fieldDrag = useDragReorder(handleFieldReorder, Boolean(authoring))

  const addFieldChip = (
    <Chip
      active
      fullWidth
      flush
      centered
      leftIcon={Plus}
      onClick={handleAddField}
      disabled={fields.length >= INTERFACE_LAYOUT_LIMITS.MAX_FORM_FIELDS}
    >
      Add field
    </Chip>
  )

  /**
   * Only the workspace arm can tell an unwired module from a wired one by its
   * config: the share arm is addressed by `(token, moduleId)` and carries no
   * workflow id at all, because the server pruned every module a visitor could
   * not run before the layout ever reached this client.
   */
  if (source.via === 'workspace' && workflowId === null) {
    if (authoring) {
      return (
        <ModuleResourcePicker
          kind='workflow'
          workspaceId={source.workspaceId}
          onSelect={(next) => updateConfig({ workflowId: next })}
        />
      )
    }
    return <ResourceEmptyState icon={FormInput} description='This form is not available.' />
  }
  if (fields.length === 0) {
    if (authoring) return <ModuleChooser title='Fields'>{addFieldChip}</ModuleChooser>
    return <ResourceEmptyState icon={FormInput} description='This form is not available.' />
  }

  const isSubmitDisabled = isEditMode || !canRun
  /** Only errors a rendered control can show count as "handled inline". */
  const hasFieldErrors = fields.some((field) => fieldErrors[field.id] !== undefined)
  const formError = submitForm.isError
    ? (unrenderedError ?? (hasFieldErrors ? null : (submitForm.error?.message ?? null)))
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
    submitForm.submit(payload, {
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
    })
  }

  return (
    <form
      className='flex h-full min-h-0 flex-col'
      onSubmit={(event) => {
        event.preventDefault()
        handleSubmit()
      }}
    >
      <div className={cn('min-h-0 flex-1 overflow-y-auto py-4', MODULE_GUTTER_X)}>
        <div className='flex flex-col gap-4'>
          {fields.map((field, index) => {
            const control = (
              <FormFieldControl
                field={field}
                value={fieldValue(field, values)}
                onChange={(next) => handleValueChange(field.id, next)}
                error={fieldErrors[field.id]}
                disabled={authoring ? true : submitForm.isPending}
                editing={
                  authoring
                    ? {
                        onLabelChange: (label) => handleFieldLabelChange(index, label),
                        onRemove: () => handleFieldRemove(index),
                      }
                    : undefined
                }
              />
            )
            if (!authoring) return <div key={field.id}>{control}</div>
            /**
             * The drop indicator is a top border rather than an inserted gap:
             * a gap reflows the list mid-drag, which moves the row under the
             * cursor and makes the target flicker.
             */
            return (
              <div
                key={field.id}
                {...fieldDrag.itemProps(index)}
                className={cn(
                  '-my-px border-transparent border-t-2 border-b-2 py-px transition-colors',
                  /**
                   * The line marks where the row will LAND. `reorderList`
                   * splices out before inserting, so a downward drag settles
                   * *after* the hovered row — drawing the line above it would
                   * point one row high.
                   */
                  fieldDrag.overIndex === index &&
                    fieldDrag.draggingIndex !== null &&
                    fieldDrag.draggingIndex !== index &&
                    (fieldDrag.draggingIndex < index
                      ? 'border-b-[var(--text-muted)]'
                      : 'border-t-[var(--text-muted)]'),
                  fieldDrag.draggingIndex === index && 'opacity-50'
                )}
              >
                {control}
              </div>
            )
          })}
          {authoring ? addFieldChip : null}
        </div>
      </div>

      <div
        className={cn(
          'flex shrink-0 items-center justify-between gap-3 border-[var(--border)] border-t py-3',
          MODULE_GUTTER_X
        )}
      >
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
          ) : !isEditMode && !canRun ? (
            <p className='text-[var(--text-muted)] text-caption'>
              You do not have access to submit this form.
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
