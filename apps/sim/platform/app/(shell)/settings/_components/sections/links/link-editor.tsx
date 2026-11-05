'use client'

import styles from '@/platform/app/(shell)/settings/_components/sections/links/links-section.module.css'
import { Button, Checkbox, FieldFrame, Modal, TextField } from '@/platform/design-system/components'
import { type LinkRow, useLinkEditor } from '@/platform/lib/data/links'

interface LinkEditorProps {
  organizationId: string
  link?: LinkRow['source']
  initialName?: string
  onClose: () => void
  onDocs: () => void
}

export function LinkEditor({
  organizationId,
  link,
  initialName,
  onClose,
  onDocs,
}: LinkEditorProps) {
  const editor = useLinkEditor(organizationId, link, initialName)
  const { draft, errors } = editor
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={link ? `Edit ${link.name}` : 'New link'}
      confirmLabel={link ? 'Save' : 'Create'}
      onConfirm={editor.save}
    >
      <TextField
        type='url'
        label='Destination URL'
        placeholder='https://'
        required
        value={draft.url}
        onChange={(value) => editor.change('url', value)}
        error={errors.url}
      />
      {editor.variable && (
        <TextField
          type='url'
          label='Default destination'
          placeholder='https://'
          optional
          value={draft.defaultUrl ?? ''}
          onChange={(value) => editor.change('defaultUrl', value || null)}
          error={errors.defaultUrl}
          hint={`Opens when no value fills ${editor.variableToken}.`}
        />
      )}
      <TextField
        label='Name'
        placeholder='handbook'
        required
        maxLength={editor.nameMaxLength}
        value={draft.name}
        onChange={editor.changeName}
        error={errors.name}
      />
      <TextField
        label='Description'
        placeholder='What is this link for?'
        optional
        maxLength={editor.descriptionMaxLength}
        value={draft.description ?? ''}
        onChange={(value) => editor.change('description', value)}
        error={errors.description}
      />
      <FieldFrame
        label='Access'
        hint={
          editor.canManage
            ? undefined
            : 'Only the creator or an organization admin can change access.'
        }
      >
        <div className={styles.access}>
          <Checkbox
            label='Hide from the Links page'
            checked={draft.unlisted}
            disabled={!editor.canManage}
            onCheckedChange={(checked) => editor.change('unlisted', checked)}
          />
          <Checkbox
            label='Only the creator and admins can edit'
            checked={draft.restrictEdit}
            disabled={!editor.canManage}
            onCheckedChange={(checked) => editor.change('restrictEdit', checked)}
          />
        </div>
      </FieldFrame>
      <div>
        <Button variant='quiet' size='compact' trailingIcon='I041' onClick={onDocs}>
          Learn more
        </Button>
      </div>
    </Modal>
  )
}
