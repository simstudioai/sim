'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import { cn } from '@/lib/core/utils/cn'
import { SkillModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/skills/components/skill-modal'
import type { SkillDefinition } from '@/hooks/queries/skills'
import { useDeleteSkill, useSkills } from '@/hooks/queries/skills'

const logger = createLogger('SkillsSettings')

function SkillSkeleton() {
  return (
    <div className='flex items-center justify-between gap-[12px]'>
      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
        <Skeleton className='h-[14px] w-[100px]' />
        <Skeleton className='h-[13px] w-[200px]' />
      </div>
      <div className='flex flex-shrink-0 items-center gap-[8px]'>
        <Skeleton className='h-[30px] w-[40px] rounded-[4px]' />
        <Skeleton className='h-[30px] w-[54px] rounded-[4px]' />
      </div>
    </div>
  )
}

export function Skills() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { data: skills = [], isLoading, error, refetch: refetchSkills } = useSkills(workspaceId)
  const deleteSkillMutation = useDeleteSkill()

  const [searchTerm, setSearchTerm] = useState('')
  const [deletingSkills, setDeletingSkills] = useState<Set<string>>(new Set())
  const [editingSkill, setEditingSkill] = useState<SkillDefinition | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [skillToDelete, setSkillToDelete] = useState<{ id: string; name: string } | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const filteredSkills = skills.filter((s) => {
    if (!searchTerm.trim()) return true
    const searchLower = searchTerm.toLowerCase()
    return (
      s.name.toLowerCase().includes(searchLower) ||
      s.description.toLowerCase().includes(searchLower)
    )
  })

  const handleDeleteClick = (skillId: string) => {
    const s = skills.find((sk) => sk.id === skillId)
    if (!s) return

    setSkillToDelete({ id: skillId, name: s.name })
    setShowDeleteDialog(true)
  }

  const handleDeleteSkill = async () => {
    if (!skillToDelete) return

    setDeletingSkills((prev) => new Set(prev).add(skillToDelete.id))
    setShowDeleteDialog(false)

    try {
      await deleteSkillMutation.mutateAsync({
        workspaceId,
        skillId: skillToDelete.id,
      })
      logger.info(`Deleted skill: ${skillToDelete.id}`)
    } catch (error) {
      logger.error('Error deleting skill:', error)
    } finally {
      setDeletingSkills((prev) => {
        const next = new Set(prev)
        next.delete(skillToDelete.id)
        return next
      })
      setSkillToDelete(null)
    }
  }

  const handleSkillSaved = () => {
    setShowAddForm(false)
    setEditingSkill(null)
    refetchSkills()
  }

  const hasSkills = skills && skills.length > 0
  const showEmptyState = !hasSkills && !showAddForm && !editingSkill
  const showNoResults = searchTerm.trim() && filteredSkills.length === 0 && skills.length > 0

  return (
    <>
      <div className='flex h-full flex-col gap-[16px]'>
        <div className='flex items-center gap-[8px]'>
          <div
            className={cn(
              'flex flex-1 items-center gap-[8px] rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[5px] transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover:border-[var(--border-1)] dark:hover:bg-[var(--surface-5)]',
              isLoading && 'opacity-50'
            )}
          >
            <Search
              className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
              strokeWidth={2}
            />
            <Input
              placeholder='Search skills...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={isLoading}
              className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-100'
            />
          </div>
          <Button onClick={() => setShowAddForm(true)} disabled={isLoading} variant='tertiary'>
            <Plus className='mr-[6px] h-[13px] w-[13px]' />
            Add
          </Button>
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto'>
          {error ? (
            <div className='flex h-full flex-col items-center justify-center gap-[8px]'>
              <p className='text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
                {error instanceof Error ? error.message : 'Failed to load skills'}
              </p>
            </div>
          ) : isLoading ? (
            <div className='flex flex-col gap-[8px]'>
              <SkillSkeleton />
              <SkillSkeleton />
              <SkillSkeleton />
            </div>
          ) : showEmptyState ? (
            <div className='flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]'>
              Click "Add" above to get started
            </div>
          ) : (
            <div className='flex flex-col gap-[8px]'>
              {filteredSkills.map((s) => (
                <div key={s.id} className='flex items-center justify-between gap-[12px]'>
                  <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                    <span className='truncate font-medium text-[14px]'>{s.name}</span>
                    <p className='truncate text-[13px] text-[var(--text-muted)]'>{s.description}</p>
                  </div>
                  <div className='flex flex-shrink-0 items-center gap-[8px]'>
                    <Button variant='default' onClick={() => setEditingSkill(s)}>
                      Edit
                    </Button>
                    <Button
                      variant='ghost'
                      onClick={() => handleDeleteClick(s.id)}
                      disabled={deletingSkills.has(s.id)}
                    >
                      {deletingSkills.has(s.id) ? 'Deleting...' : 'Delete'}
                    </Button>
                  </div>
                </div>
              ))}
              {showNoResults && (
                <div className='py-[16px] text-center text-[13px] text-[var(--text-muted)]'>
                  No skills found matching "{searchTerm}"
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <SkillModal
        open={showAddForm || !!editingSkill}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddForm(false)
            setEditingSkill(null)
          }
        }}
        onSave={handleSkillSaved}
        onDelete={(skillId) => {
          setEditingSkill(null)
          handleDeleteClick(skillId)
        }}
        initialValues={editingSkill ?? undefined}
      />

      <Modal open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <ModalContent size='sm'>
          <ModalHeader>Delete Skill</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>{skillToDelete?.name}</span>?{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleDeleteSkill}>
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
