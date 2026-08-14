import type { ReactNode } from 'react'
import { Button, cn, Tooltip } from '@sim/emcn'
import { CircleInfo } from '@sim/emcn/icons'
import { groupSubBlocksIntoEditorSections } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/lib/editor-sections'
import type { SubBlockConfig } from '@/blocks/types'

interface BlockEditorSectionsProps {
  blockType: string
  subBlocks: SubBlockConfig[]
  children: (subBlock: SubBlockConfig) => ReactNode
}

const FIELD_LIST_CLASS_NAME = 'flex flex-col gap-4'

/**
 * Adds consistent information hierarchy to selected representative blocks
 * without changing the controls that render each subblock.
 */
export function BlockEditorSections({ blockType, subBlocks, children }: BlockEditorSectionsProps) {
  const sections = groupSubBlocksIntoEditorSections(blockType, subBlocks)

  if (!sections) {
    return <div className={FIELD_LIST_CLASS_NAME}>{subBlocks.map(children)}</div>
  }

  return (
    <div className='flex flex-col'>
      {sections.map((section, index) => (
        <section
          key={section.id}
          aria-labelledby={`block-editor-section-${section.id}`}
          className={cn('flex flex-col', index === 0 ? 'pt-1 pb-4' : 'pt-4 pb-4')}
        >
          <div className='mb-4 flex items-center gap-1 pl-0.5'>
            <h3
              id={`block-editor-section-${section.id}`}
              className='font-medium text-[var(--text-primary)] text-small'
            >
              {section.title}
            </h3>
            {section.description ? (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    className='size-[18px] rounded-full p-0'
                    aria-label={`About ${section.title}`}
                  >
                    <CircleInfo className='size-[14px] text-[var(--text-icon)]' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>
                  <p>{section.description}</p>
                </Tooltip.Content>
              </Tooltip.Root>
            ) : null}
          </div>
          <div className={FIELD_LIST_CLASS_NAME}>{section.subBlocks.map(children)}</div>
        </section>
      ))}
    </div>
  )
}
