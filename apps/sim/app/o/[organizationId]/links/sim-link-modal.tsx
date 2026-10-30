'use client'

import { useId, useState } from 'react'
import {
  Checkbox,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { isApiClientError } from '@/lib/api/client/errors'
import type { SimLink, SimLinkBody } from '@/lib/api/contracts/sim-links'
import {
  isVariableSimLinkUrl,
  SIM_LINK_DESCRIPTION_MAX_LENGTH,
  SIM_LINK_NAME_MAX_LENGTH,
  SIM_LINK_VARIABLE,
  simLinkFieldsSchema,
} from '@/lib/sim-links/validation'
import { useCreateSimLink, useUpdateSimLink } from '@/hooks/queries/sim-links'

type Field = 'name' | 'url' | 'defaultUrl' | 'description'

interface SimLinkModalProps {
  organizationId: string
  onClose: () => void
  /** The link being edited; omit to create one. */
  link?: SimLink
  /** Prefills the name of a new link, such as one opened from an unknown sim/ link. */
  initialName?: string
}

function draftOf(link: SimLink | undefined, initialName = ''): SimLinkBody {
  return {
    name: link?.name ?? initialName,
    url: link?.url ?? '',
    defaultUrl: link?.defaultUrl ?? null,
    description: link?.description ?? '',
    unlisted: link?.unlisted ?? false,
    restrictEdit: link?.restrictEdit ?? false,
  }
}

/** Mount per link (keyed) so each open starts from that link's saved fields. */
export function SimLinkModal({ organizationId, onClose, link, initialName }: SimLinkModalProps) {
  const create = useCreateSimLink(organizationId)
  const update = useUpdateSimLink(organizationId)
  const mutation = link ? update : create
  const nameTaken = isApiClientError(mutation.error) && mutation.error.status === 409
  const [draft, setDraft] = useState(() => draftOf(link, initialName))
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const variable = isVariableSimLinkUrl(draft.url)
  const canManage = link?.canManage ?? true
  const unlistedId = useId()
  const restrictEditId = useId()

  const change = <K extends keyof SimLinkBody>(field: K, value: SimLinkBody[K]) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    if (mutation.isError) mutation.reset()
  }

  const save = () => {
    const parsed = simLinkFieldsSchema.safeParse({
      ...draft,
      defaultUrl: variable ? draft.defaultUrl : null,
    })
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])
        )
      )
      return
    }
    if (link) update.mutate({ linkId: link.id, body: parsed.data }, { onSuccess: onClose })
    else create.mutate(parsed.data, { onSuccess: onClose })
  }

  const title = link ? `Edit sim/${link.name}` : 'New Sim link'

  return (
    <ChipModal
      open
      onOpenChange={(open) => !open && onClose()}
      dismissDisabled={mutation.isPending}
      srTitle={title}
    >
      <ChipModalHeader onClose={onClose}>{title}</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title='Destination URL'
          required
          inputType='url'
          placeholder='https://'
          value={draft.url}
          onChange={(value) => change('url', value)}
          error={errors.url}
          hint={
            variable
              ? `Variable link: sim/${draft.name || 'name'}/value fills each ${SIM_LINK_VARIABLE}.`
              : `Add ${SIM_LINK_VARIABLE} where a value typed after the name should go.`
          }
        />
        {variable && (
          <ChipModalField
            type='input'
            title='Default destination'
            inputType='url'
            placeholder='https://'
            value={draft.defaultUrl ?? ''}
            onChange={(value) => change('defaultUrl', value || null)}
            error={errors.defaultUrl}
            hint={`Opens when sim/${draft.name || 'name'} is used without a value.`}
          />
        )}
        <ChipModalField
          type='input'
          title='Name'
          required
          placeholder='handbook'
          maxLength={SIM_LINK_NAME_MAX_LENGTH}
          value={draft.name}
          onChange={(value) => change('name', value)}
          error={errors.name ?? (nameTaken ? mutation.error?.message : undefined)}
          hint='Letters, numbers, and . : @ & ~ - _. Case and punctuation are ignored, so sim/Q4-goals is sim/q4goals.'
        />
        <ChipModalField
          type='input'
          title='Description'
          placeholder='What is this link for?'
          maxLength={SIM_LINK_DESCRIPTION_MAX_LENGTH}
          value={draft.description ?? ''}
          onChange={(value) => change('description', value)}
          error={errors.description}
        />
        <ChipModalField
          type='custom'
          title='Access'
          hint={
            canManage
              ? 'Anyone in your organization can open this link.'
              : 'Only the creator or an organization admin can change access.'
          }
        >
          <div className='flex flex-col gap-2'>
            <label htmlFor={unlistedId} className='flex cursor-pointer items-center gap-2'>
              <Checkbox
                id={unlistedId}
                checked={draft.unlisted}
                disabled={!canManage}
                onCheckedChange={(checked) => change('unlisted', checked === true)}
              />
              <span className='text-[var(--text-primary)] text-small'>
                Hide from the Sim Links page for everyone except you and admins
              </span>
            </label>
            <label htmlFor={restrictEditId} className='flex cursor-pointer items-center gap-2'>
              <Checkbox
                id={restrictEditId}
                checked={draft.restrictEdit}
                disabled={!canManage}
                onCheckedChange={(checked) => change('restrictEdit', checked === true)}
              />
              <span className='text-[var(--text-primary)] text-small'>
                Restrict editing to you and admins
              </span>
            </label>
          </div>
        </ChipModalField>
        <ChipModalError>{nameTaken ? undefined : mutation.error?.message}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        primaryAction={{
          label: link ? 'Save' : 'Create',
          pendingLabel: link ? 'Saving' : 'Creating',
          pending: mutation.isPending,
          disabled: mutation.isPending,
          onClick: save,
        }}
      />
    </ChipModal>
  )
}
