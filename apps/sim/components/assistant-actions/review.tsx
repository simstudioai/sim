'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'
import {
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  OverflowText,
  toast,
} from '@sim/emcn'
import { Hand } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { omit } from '@sim/utils/object'
import type { AssistantActionsResponse } from '@/lib/api/contracts/assistant-actions'
import {
  useAssistantActionReview,
  useDecideAssistantAction,
} from '@/hooks/queries/assistant-actions'

type ReviewAction = AssistantActionsResponse['actions'][number]
type ReviewEdits = Record<string, { proposalVersion: string; fields: Record<string, string> }>

const reviewContext = createContext<{ open: () => void; panel: ReactNode } | null>(null)

interface AssistantActionReviewProviderProps {
  organizationId: string
  chatId?: string
  active: boolean
  enabled: boolean
  children: ReactNode
}

export function AssistantActionReviewProvider({
  organizationId,
  chatId,
  active,
  enabled,
  children,
}: AssistantActionReviewProviderProps) {
  const query = useAssistantActionReview(organizationId, chatId ?? '', active, enabled)
  const mutation = useDecideAssistantAction(organizationId, chatId ?? '')
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [edits, setEdits] = useState<ReviewEdits>({})
  const actions = query.data?.actions ?? []
  const submit = async (selected: ReviewAction[], decision: 'allow' | 'skip') => {
    if (submitting) return
    setSubmitting(true)
    try {
      for (const action of selected) {
        const draft = edits[action.toolCallId]
        try {
          await mutation.mutateAsync({
            toolCallId: action.toolCallId,
            runId: action.runId,
            proposalVersion: action.proposalVersion,
            decision,
            ...(decision === 'allow' && draft?.proposalVersion === action.proposalVersion
              ? { edits: draft.fields }
              : {}),
          })
          setEdits((current) => omit(current, [action.toolCallId]))
        } catch (error) {
          toast.error(getErrorMessage(error, 'Could not save this review'))
        }
      }
    } finally {
      setSubmitting(false)
    }
  }
  const panel =
    !enabled || (!actions.length && !query.error) ? null : (
      <div className='mb-3 flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-3'>
        <div className='flex items-center justify-between gap-3'>
          <span className='flex items-center gap-2 font-medium text-[var(--text-body)] text-small'>
            <Hand className='size-[14px]' />
            {actions.length
              ? `${actions.length} ${actions.length === 1 ? 'action' : 'actions'} to review`
              : 'Action review unavailable'}
          </span>
          <Chip onClick={() => (actions.length ? setOpen(true) : void query.refetch())}>
            {actions.length ? 'Review' : 'Retry'}
          </Chip>
        </div>
        {actions.slice(0, 3).map((action) => (
          <OverflowText
            key={action.toolCallId}
            label={`${action.name} · ${
              action.fields.find((field) => field.target && field.value)?.value ??
              action.account?.displayName ??
              'Account unavailable'
            }`}
            className='text-[var(--text-muted)] text-small'
          />
        ))}
        {actions.length > 3 && (
          <p className='text-[var(--text-muted)] text-small'>And {actions.length - 3} more</p>
        )}
      </div>
    )
  return (
    <reviewContext.Provider value={enabled ? { open: () => setOpen(true), panel } : null}>
      {children}
      <ChipModal
        open={enabled && open}
        onOpenChange={setOpen}
        dismissDisabled={submitting}
        size='lg'
        srTitle='Review Assistant actions'
      >
        <ChipModalHeader icon={Hand} onClose={() => setOpen(false)}>
          Review actions
        </ChipModalHeader>
        <ChipModalBody>
          <p className='px-2 text-[var(--text-muted)] text-small'>
            Review each action before it runs. Allow and Cancel apply only to these proposals.
          </p>
          {actions.map((action) => (
            <ActionReview
              key={`${action.toolCallId}:${action.proposalVersion}`}
              action={action}
              edits={
                edits[action.toolCallId]?.proposalVersion === action.proposalVersion
                  ? (edits[action.toolCallId]?.fields ?? {})
                  : {}
              }
              disabled={submitting}
              onEdit={(name, value) =>
                setEdits((current) => ({
                  ...current,
                  [action.toolCallId]: {
                    proposalVersion: action.proposalVersion,
                    fields: {
                      ...(current[action.toolCallId]?.proposalVersion === action.proposalVersion
                        ? current[action.toolCallId].fields
                        : {}),
                      [name]: value,
                    },
                  },
                }))
              }
              onDecide={(decision) => void submit([action], decision)}
            />
          ))}
          {!actions.length && (
            <p className='px-2 text-[var(--text-muted)] text-small'>
              {query.error
                ? 'Could not load the current actions. Close this review and retry.'
                : 'No actions are waiting for review.'}
            </p>
          )}
          {query.data?.nextCursor !== null && query.data?.nextCursor !== undefined && (
            <p className='px-2 text-[var(--text-muted)] text-small'>
              More actions are waiting. Review these first.
            </p>
          )}
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => setOpen(false)}
          cancelLabel='Close'
          defaultAction='none'
          primaryAction={{
            label: actions.length > 1 ? `Allow ${actions.length} shown` : 'Allow',
            onClick: () => void submit(actions, 'allow'),
            disabled: submitting || !actions.length,
          }}
        />
      </ChipModal>
    </reviewContext.Provider>
  )
}

interface ActionReviewProps {
  action: ReviewAction
  edits: Record<string, string>
  disabled: boolean
  onEdit: (name: string, value: string) => void
  onDecide: (decision: 'allow' | 'skip') => void
}

function ActionReview({ action, edits, disabled, onEdit, onDecide }: ActionReviewProps) {
  return (
    <section className='flex flex-col gap-3 border-[var(--border)] border-b pb-4 last:border-0'>
      <ChipModalField
        type='custom'
        title={action.name}
        hint={action.account?.displayName ?? 'Account unavailable'}
      >
        <div className='flex flex-wrap gap-2'>
          <Chip disabled={disabled || !action.account} onClick={() => onDecide('allow')}>
            Allow
          </Chip>
          <Chip disabled={disabled} onClick={() => onDecide('skip')}>
            Cancel
          </Chip>
        </div>
      </ChipModalField>
      {action.fields
        .filter((field) => field.value || field.editable)
        .map((field) =>
          field.editable ? (
            <ChipModalField
              key={field.name}
              type='textarea'
              title={field.label}
              value={edits[field.name] ?? field.value}
              disabled={disabled}
              maxLength={65_536}
              onChange={(value) => onEdit(field.name, value)}
              rows={field.format === 'multiline' ? 4 : 2}
            />
          ) : (
            <ChipModalField
              key={field.name}
              type='textarea'
              title={field.label}
              value={field.value}
              viewOnly
              rows={field.format === 'text' ? 2 : 4}
              mono={field.format === 'json'}
            />
          )
        )}
    </section>
  )
}

export function AssistantActionReviewPanel() {
  return useContext(reviewContext)?.panel ?? null
}

interface AssistantActionReviewStatusProps {
  title: string
  fallback: ReactNode
}

export function AssistantActionReviewStatus({ title, fallback }: AssistantActionReviewStatusProps) {
  const review = useContext(reviewContext)
  return review ? (
    <Chip leftIcon={Hand} onClick={review.open}>
      {title} · Review
    </Chip>
  ) : (
    fallback
  )
}
