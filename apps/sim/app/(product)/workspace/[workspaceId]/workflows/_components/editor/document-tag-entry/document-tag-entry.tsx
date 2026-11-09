'use client'

import { useState } from 'react'
import { InlineNotice } from '@sim/emcn/status'
import { generateId } from '@sim/utils/id'
import { useActiveSearchTarget } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/document-tag-entry/document-tag-entry.module.css'
import {
  type DocumentTag,
  TagEntryRow,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/document-tag-entry/tag-entry-row'
import { RuleList } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/filter-builder/rule-card'
import {
  parseJsonArrayValue,
  type SubBlockConfig,
  useAccessibleReferencePrefixes,
  useDependsOnGate,
  useSubBlockInput,
  useSubBlockValue,
  useTagSelection,
} from '@/platform/lib/data/workflow-editor'
import { useKnowledgeBaseTagDefinitions } from '@/platform/lib/data/workflow-editor/builders'

interface DocumentTagEntryProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: unknown
  previewContextValues?: Record<string, unknown>
}

const createDefaultTag = (): DocumentTag => ({
  id: generateId(),
  tagName: '',
  fieldType: 'text',
  value: '',
  collapsed: false,
})

const parseTags = (value: unknown): DocumentTag[] =>
  parseJsonArrayValue<DocumentTag>(value).map((tag) => ({
    ...tag,
    fieldType: tag.fieldType || 'text',
    collapsed: tag.collapsed ?? false,
  }))

/**
 * The tags of a document a knowledge block creates, stored as a JSON string: each names a tag of the
 * selected knowledge base (each tag at most once) and a reference-aware value. The last entry resets
 * rather than disappearing, and a preview shows only how many are configured.
 */
export function DocumentTagEntry({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
  previewContextValues,
}: DocumentTagEntryProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlock.id)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const controller = useSubBlockInput({
    blockId,
    subBlockId: subBlock.id,
    config: { id: subBlock.id, type: 'document-tag-entry', connectionDroppable: true },
    isPreview,
    disabled,
  })
  const { dependencyValues } = useDependsOnGate(blockId, subBlock, {
    disabled,
    isPreview,
    previewContextValues,
  })
  const knowledgeBaseIdValue = dependencyValues.knowledgeBaseSelector
  const knowledgeBaseId =
    typeof knowledgeBaseIdValue === 'string' && knowledgeBaseIdValue.trim().length > 0
      ? knowledgeBaseIdValue
      : null
  const { tagDefinitions, isLoading } = useKnowledgeBaseTagDefinitions(knowledgeBaseId)
  const emitTagSelection = useTagSelection(blockId, subBlock.id)
  const [placeholderTag] = useState(createDefaultTag)

  const parsedTags = parseTags(isPreview ? previewValue : storeValue)
  const tags = parsedTags.length > 0 ? parsedTags : [placeholderTag]
  const readOnly = isPreview || disabled

  const usedTagNames = new Set(
    tags.map((tag) => tag.tagName?.toLowerCase()).filter((tagName) => tagName?.trim())
  )
  const canAddMore = tagDefinitions.some(
    (definition) => !usedTagNames.has(definition.displayName.toLowerCase())
  )

  const writeTags = (next: DocumentTag[]) => {
    if (readOnly) return
    setStoreValue(next.length > 0 ? JSON.stringify(next) : '')
  }

  const addTag = () => {
    if (!canAddMore) return
    writeTags([...tags, createDefaultTag()])
  }

  const removeTag = (id: string) =>
    writeTags(tags.length === 1 ? [createDefaultTag()] : tags.filter((tag) => tag.id !== id))

  /** A newly chosen tag takes its slot and type, and clears a value meant for the previous tag. */
  const changeTag = (id: string, tagName: string) =>
    writeTags(
      tags.map((tag) => {
        if (tag.id !== id) return tag
        const definition = tagDefinitions.find((candidate) => candidate.displayName === tagName)
        return {
          ...tag,
          tagName,
          tagSlot: definition?.tagSlot,
          fieldType: definition?.fieldType || 'text',
          value: tag.tagName !== tagName ? '' : tag.value,
        }
      })
    )

  const changeValue = (id: string, value: string) =>
    writeTags(tags.map((tag) => (tag.id === id ? { ...tag, value } : tag)))

  const selectReference = (id: string, value: string) => {
    if (readOnly) return
    emitTagSelection(JSON.stringify(tags.map((tag) => (tag.id === id ? { ...tag, value } : tag))))
  }

  const toggleCollapse = (id: string) =>
    writeTags(tags.map((tag) => (tag.id === id ? { ...tag, collapsed: !tag.collapsed } : tag)))

  if (isPreview) {
    const configured = tags.filter((tag) => tag.tagName?.trim()).length
    return (
      <span className={styles.summary} data-type='T052'>
        {configured === 0
          ? 'No tags'
          : `${configured} ${configured === 1 ? 'tag' : 'tags'} configured`}
      </span>
    )
  }

  if (!isLoading && tagDefinitions.length === 0 && knowledgeBaseId) {
    return (
      <InlineNotice
        title='No tags defined for this knowledge base'
        message='Define tags at the knowledge base level first'
      />
    )
  }

  return (
    <RuleList>
      {tags.map((tag, index) => (
        <TagEntryRow
          key={tag.id}
          blockId={blockId}
          subBlockId={subBlock.id}
          tag={tag}
          index={index}
          tagOptions={tagDefinitions
            .filter(
              (definition) =>
                definition.displayName === tag.tagName ||
                !usedTagNames.has(definition.displayName.toLowerCase())
            )
            .map((definition) => ({
              value: definition.displayName,
              label: definition.displayName,
            }))}
          tagsLoading={isLoading}
          canAddMore={canAddMore}
          readOnly={readOnly}
          controller={controller}
          accessiblePrefixes={accessiblePrefixes}
          activeSearchTarget={activeSearchTarget}
          onAdd={addTag}
          onRemove={removeTag}
          onChangeTag={changeTag}
          onChangeValue={changeValue}
          onReferenceSelect={selectReference}
          onToggleCollapse={toggleCollapse}
        />
      ))}
    </RuleList>
  )
}
