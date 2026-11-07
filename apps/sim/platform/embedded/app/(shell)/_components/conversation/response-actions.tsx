'use client'

import type { MessageActionsModel } from '@/app/workspace/[workspaceId]/components/message-actions/message-actions'
import {
  ActionMenu,
  CopyField,
  FieldFrame,
  IconButton,
  Modal,
  SegmentedControl,
} from '@/platform/design-system/components'
import { TextArea } from '@/platform/design-system/components/field/inputs'
import { Surface } from '@/platform/design-system/components/surface/surface'
import styles from '@/platform/embedded/app/(shell)/_components/conversation/conversation.module.css'
import { BodyDialog } from '@/platform/embedded/app/(shell)/_components/conversation/dialogs'

const RATINGS = [
  { value: 'up', label: 'Good response', icon: 'I017' },
  { value: 'down', label: 'Bad response', icon: 'I008' },
] as const

/**
 * A reply's copy, rate, and fork, in the design's controls beside the legacy sources button.
 * `MessageActions` keeps what each one does. The details field is uncontrolled so the form owns its
 * reset: it unmounts with the rating and returns empty.
 */
export function ResponseActions(actions: MessageActionsModel) {
  const { rating, requestId } = actions
  return (
    <Surface>
      <div className={styles.responseActionRow}>
        {actions.canCopy && (
          <IconButton
            tooltip
            label={actions.copied ? 'Copied message' : 'Copy message'}
            icon={actions.copied ? 'I072' : 'I006'}
            onClick={actions.onCopy}
          />
        )}
        {actions.canRate && (
          <ActionMenu
            icon='I017'
            label='Rate response'
            actions={RATINGS.map(({ value, label, icon }) => ({
              id: value,
              label,
              icon,
              onSelect: () => actions.onRate(value),
            }))}
          />
        )}
        {actions.canFork && (
          <IconButton
            tooltip
            label='Fork in new chat'
            icon='I118'
            disabled={actions.forking}
            onClick={actions.onFork}
          />
        )}
      </div>
      {rating && (
        <BodyDialog>
          <Modal
            variant='feedback'
            open
            onOpenChange={(open) => {
              if (!open) actions.onDismissRating()
            }}
            title='Share feedback'
            description='What could Sim have done better?'
            confirmLabel='Send feedback'
            onConfirm={(values) => actions.onSubmitRating(String(values.get('details') ?? ''))}
          >
            <FieldFrame label='Response quality'>
              <SegmentedControl
                label='Response quality'
                value={rating}
                options={RATINGS}
                onSelect={actions.onRate}
              />
            </FieldFrame>
            <FieldFrame label='Details' optional>
              <TextArea
                label='Details'
                placeholder={
                  rating === 'up' ? 'Tell us what was helpful…' : 'Tell us what went wrong…'
                }
                defaultSize='expanded'
                name='details'
              />
            </FieldFrame>
            {rating === 'down' && requestId && <CopyField label='Request ID' value={requestId} />}
          </Modal>
        </BodyDialog>
      )}
    </Surface>
  )
}
