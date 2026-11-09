'use client'

import { Button } from '@sim/emcn/button'
import { Checkbox } from '@sim/emcn/checkbox'
import { FieldFrame, TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import styles from '@/app/(product)/_components/links-page/links-page.module.css'
import {
  LINK_LIMITS,
  type LinkRecord,
  openLinkDocs,
  useLinkEditor,
} from '@/platform/lib/data/links'

interface LinkEditorProps {
  organizationId: string
  /** The link being edited; omit to create one. */
  link?: LinkRecord
  /** Prefills the name of a new link, such as one opened from an unknown sim/ link. */
  initialName?: string
  /** Prefills the destination of a new link, such as a shared file's public link. */
  initialUrl?: string
  onClose: () => void
}

/**
 * The URL fields are plain text and nothing is `required`, so a problem reaches the shared schema
 * and shows its message on the field instead of a browser validation bubble.
 */
export function LinkEditor({
  organizationId,
  link,
  initialName,
  initialUrl,
  onClose,
}: LinkEditorProps) {
  const editor = useLinkEditor(organizationId, link, initialName, initialUrl)
  const { draft, errors, pending } = editor
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
        inputMode='url'
        label='Destination URL'
        placeholder='https://'
        disabled={pending}
        value={draft.url}
        onChange={(value) => editor.change('url', value)}
        error={errors.url}
      />
      {editor.variable && (
        <TextField
          inputMode='url'
          label='Default destination'
          placeholder='https://'
          optional
          disabled={pending}
          value={draft.defaultUrl ?? ''}
          onChange={(value) => editor.change('defaultUrl', value || null)}
          error={errors.defaultUrl}
          hint={`Opens when no value fills ${LINK_LIMITS.variable}.`}
        />
      )}
      <TextField
        label='Name'
        placeholder='handbook'
        disabled={pending}
        maxLength={LINK_LIMITS.name}
        value={draft.name}
        onChange={editor.changeName}
        error={errors.name}
      />
      <TextField
        label='Description'
        placeholder='What is this link for?'
        optional
        disabled={pending}
        maxLength={LINK_LIMITS.description}
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
            disabled={!editor.canManage || pending}
            onCheckedChange={(checked) => editor.change('unlisted', checked)}
          />
          <Checkbox
            label='Only the creator and admins can edit'
            checked={draft.restrictEdit}
            disabled={!editor.canManage || pending}
            onCheckedChange={(checked) => editor.change('restrictEdit', checked)}
          />
        </div>
      </FieldFrame>
      <div>
        <Button variant='quiet' size='compact' trailingIcon='I037' onClick={openLinkDocs}>
          Learn more
        </Button>
      </div>
    </Modal>
  )
}
