'use client'

import { useTranslations } from 'next-intl'
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/emcn'

interface DeleteModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  isDeleting: boolean
  itemType: 'workflow' | 'folder' | 'workspace' | 'mixed'
  itemName?: string | string[]
}

const TITLE_KEYS: Record<string, string> = {
  'workflow-single': 'workflows.delete_modal.titles.workflow_single',
  'workflow-multiple': 'workflows.delete_modal.titles.workflow_multiple',
  'folder-single': 'workflows.delete_modal.titles.folder_single',
  'folder-multiple': 'workflows.delete_modal.titles.folder_multiple',
  mixed: 'workflows.delete_modal.titles.mixed',
  workspace: 'workflows.delete_modal.titles.workspace',
} as const

const DESCRIPTION_KEYS: Record<string, string> = {
  'workflow-single-named': 'workflows.delete_modal.descriptions.workflow_single_named',
  'workflow-single-unnamed': 'workflows.delete_modal.descriptions.workflow_single_unnamed',
  'workflow-multiple-named': 'workflows.delete_modal.descriptions.workflow_multiple_named',
  'workflow-multiple-unnamed': 'workflows.delete_modal.descriptions.workflow_multiple_unnamed',
  'folder-single-named': 'workflows.delete_modal.descriptions.folder_single_named',
  'folder-single-unnamed': 'workflows.delete_modal.descriptions.folder_single_unnamed',
  'folder-multiple-named': 'workflows.delete_modal.descriptions.folder_multiple_named',
  'folder-multiple-unnamed': 'workflows.delete_modal.descriptions.folder_multiple_unnamed',
  'mixed-named': 'workflows.delete_modal.descriptions.mixed_named',
  'mixed-unnamed': 'workflows.delete_modal.descriptions.mixed_unnamed',
  'workspace-named': 'workflows.delete_modal.descriptions.workspace_single_named',
  'workspace-unnamed': 'workflows.delete_modal.descriptions.workspace_single_unnamed',
} as const

export function DeleteModal({
  isOpen,
  onClose,
  onConfirm,
  isDeleting,
  itemType,
  itemName,
}: DeleteModalProps) {
  const t = useTranslations()

  const names = Array.isArray(itemName) ? itemName : itemName ? [itemName] : []
  const isMultiple = names.length > 1
  const hasNames = names.length > 0

  const getTitleKey = (): string => {
    if (itemType === 'mixed' || itemType === 'workspace') {
      return TITLE_KEYS[itemType]
    }
    const key = `${itemType}-${isMultiple ? 'multiple' : 'single'}`
    return TITLE_KEYS[key as keyof typeof TITLE_KEYS]
  }

  const getDescriptionKey = (): string => {
    const type = itemType === 'mixed' ? 'mixed' : itemType === 'workspace' ? 'workspace' : itemType
    const plurality = itemType === 'workspace' ? 'single' : isMultiple ? 'multiple' : 'single'
    const named = hasNames ? 'named' : 'unnamed'
    const key = `${type}-${plurality}-${named}`
    return (
      DESCRIPTION_KEYS[key as keyof typeof DESCRIPTION_KEYS] ??
      'workflows.delete_modal.descriptions.workflow_single_unnamed'
    )
  }

  const title = t(getTitleKey() as any)
  const descriptionKey = getDescriptionKey()

  const descriptionText = hasNames
    ? isMultiple
      ? t(descriptionKey as any, { names: names.join(', ') })
      : t(descriptionKey as any, { name: names[0] })
    : t(descriptionKey as any)

  return (
    <Modal open={isOpen} onOpenChange={onClose}>
      <ModalContent size='sm'>
        <ModalHeader>{title}</ModalHeader>
        <ModalBody>
          <p className='text-[12px] text-[var(--text-secondary)]'>
            {descriptionText}{' '}
            <span className='text-[var(--text-error)]'>
              {t('workflows.delete_modal.descriptions.cannot_undo')}
            </span>
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={onClose} disabled={isDeleting}>
            {t('workflows.delete_modal.buttons.cancel')}
          </Button>
          <Button variant='destructive' onClick={onConfirm} disabled={isDeleting}>
            {isDeleting
              ? t('workflows.delete_modal.buttons.deleting')
              : t('workflows.delete_modal.buttons.delete')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
