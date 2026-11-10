'use client'

import {
  type MouseEvent,
  memo,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import { isEqual } from 'es-toolkit'
import { workspacePath } from '@/lib/navigation/paths'
import { CheckboxList } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/checkbox-list/checkbox-list'
import { Code } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/code/code'
import { ComboBox } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/combobox/combobox'
import { ConditionInput } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/condition-input/condition-input'
import { CredentialSelector } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/credential-selector/credential-selector'
import { DocumentTagEntry } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/document-tag-entry/document-tag-entry'
import { Dropdown } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/dropdown/dropdown'
import { EvalInput } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/eval-input/eval-input'
import { FileUpload } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/file-upload/file-upload'
import { FilterBuilder } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/filter-builder/filter-builder'
import { GroupedCheckboxList } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/grouped-checkbox-list/grouped-checkbox-list'
import { InputFormat } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/input-format/input-format'
import { InputMapping } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/input-mapping/input-mapping'
import { KnowledgeBaseSelector } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/knowledge-base-selector/knowledge-base-selector'
import { KnowledgeTagFilters } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/knowledge-tag-filters/knowledge-tag-filters'
import { LongInput } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/long-input/long-input'
import { McpDynamicArgs } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/mcp-dynamic-args/mcp-dynamic-args'
import {
  McpServerSelector,
  McpToolSelector,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/mcp-selectors/mcp-selectors'
import { MessagesInput } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/messages-input/messages-input'
import { ModelFallbackList } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/model-fallback-list/model-fallback-list'
import { ResponseFormat } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/response-format/response-format'
import { ScheduleInfo } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/schedule-info/schedule-info'
import {
  SelectorInput,
  type SelectorOverrides,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/selector-input/selector-input'
import { ShortInput } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/short-input/short-input'
import { SkillInput } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/skill-input/skill-input'
import { SlackSetupWizard } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/slack-setup-wizard/slack-setup-wizard'
import { SliderInput } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/slider-input/slider-input'
import { SortBuilder } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/sort-builder/sort-builder'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/sub-block/sub-block.module.css'
import { SubBlockLabel } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/sub-block/sub-block-label'
import type { WandControlHandlers } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/sub-block/wand-control'
import { SwitchInput } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/switch-input/switch-input'
import { Table } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/table/table'
import { TableSelector } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/table-selector/table-selector'
import { TextBlock } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/text-block/text-block'
import { TimeInput } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/time-input/time-input'
import { ToolInput } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/tool-input/tool-input'
import { VariablesInput } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/variables-input/variables-input'
import { WorkflowInputMapper } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/workflow-input-mapper/workflow-input-mapper'
import { WorkflowOutputSelector } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/workflow-output-selector/workflow-output-selector'
import { WorkflowSelectorInput } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/workflow-selector/workflow-selector'
import { WorkspaceFolderSelector } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/workspace-folder-selector/workspace-folder-selector'
import {
  buildSubBlockValues,
  isFieldRequired,
  type SubBlockConfig,
  useDependsOnGate,
  useWebhookManagement,
  useWorkflowScope,
} from '@/platform/lib/data/workflow-editor'

/** Sub-block values keyed by id, each wrapped as the store keeps it: `{ value }`. */
export type SubBlockValues = Record<string, { value?: unknown } | undefined>

/** Slack's channel and user pickers read their token from whichever credential field is active. */
const SLACK_OVERRIDES: SelectorOverrides = {
  transformContext: (context, deps) => {
    const authMethod = deps.authMethod as string
    const oauthCredential =
      authMethod === 'bot_token'
        ? String(deps.botToken ?? '')
        : String(deps.credential ?? deps.customBotCredential ?? '')
    return { ...context, oauthCredential }
  },
}

/** Gmail folder pickers start on the inbox, except a copy destination. */
const FOLDER_OVERRIDES: SelectorOverrides = {
  getDefaultValue: (subBlock) => {
    const isGmail = subBlock.serviceId === 'gmail'
    const isCopyDest = subBlock.canonicalParamId === 'copyDestinationId'
    return isGmail && !isCopyDest ? 'INBOX' : null
  },
}

/** The modal-launching sub-blocks, by `modalId`. */
const MODAL_REGISTRY: Readonly<
  Record<string, (props: { blockId: string; isPreview?: boolean; disabled?: boolean }) => ReactNode>
> = {
  'slack-setup-wizard': SlackSetupWizard,
}

/** The basic/advanced swap a canonical pair shows on its label row. */
export interface CanonicalToggle {
  mode: 'basic' | 'advanced'
  disabled?: boolean
  onToggle?: () => void
}

interface SubBlockProps {
  blockId: string
  config: SubBlockConfig
  isPreview?: boolean
  subBlockValues?: SubBlockValues
  disabled?: boolean
  allowExpandInPreview?: boolean
  canonicalToggle?: CanonicalToggle
  labelSuffix?: ReactNode
  /** Sibling values for dependency resolution outside the block's own store, as in a tool. */
  dependencyContext?: Record<string, unknown>
}

function previewOf(config: SubBlockConfig, isPreview: boolean, values?: SubBlockValues): unknown {
  if (!isPreview || !values) return undefined
  return values[config.id]?.value ?? null
}

function arePropsEqual(prev: SubBlockProps, next: SubBlockProps): boolean {
  const id = prev.config.id
  const prevValue = prev.subBlockValues?.[id]?.value
  const nextValue = next.subBlockValues?.[id]?.value
  return (
    prev.blockId === next.blockId &&
    prev.config.id === next.config.id &&
    prev.config.type === next.config.type &&
    prev.isPreview === next.isPreview &&
    (prevValue === nextValue || isEqual(prevValue, nextValue)) &&
    prev.disabled === next.disabled &&
    prev.allowExpandInPreview === next.allowExpandInPreview &&
    Boolean(prev.canonicalToggle) === Boolean(next.canonicalToggle) &&
    prev.canonicalToggle?.mode === next.canonicalToggle?.mode &&
    prev.canonicalToggle?.disabled === next.canonicalToggle?.disabled &&
    prev.labelSuffix === next.labelSuffix &&
    prev.dependencyContext === next.dependencyContext
  )
}

function stopCanvasDrag(event: MouseEvent<HTMLDivElement>) {
  event.stopPropagation()
}

/**
 * One configurable field of a block: its label row (required mark, JSON validity, webhook copy,
 * AI generate, linked resource, basic/advanced swap) above the input its `type` names, gated by
 * `dependsOn`.
 */
function SubBlockComponent({
  blockId,
  config,
  isPreview = false,
  subBlockValues,
  disabled = false,
  allowExpandInPreview,
  canonicalToggle,
  labelSuffix,
  dependencyContext,
}: SubBlockProps) {
  const { workspaceId } = useWorkflowScope()
  const [isValidJson, setIsValidJson] = useState(true)
  const wandControlRef = useRef<WandControlHandlers | null>(null)

  const webhookManagement = useWebhookManagement({
    blockId,
    triggerId: undefined,
    isPreview,
    useWebhookUrl: config.useWebhookUrl,
    providerWebhookUrl: config.providerWebhookUrl,
  })

  const previewValue = previewOf(config, isPreview, subBlockValues)
  const requiredValues =
    !isPreview && dependencyContext
      ? dependencyContext
      : subBlockValues
        ? buildSubBlockValues(subBlockValues)
        : undefined
  const contextValues = dependencyContext ?? (isPreview ? subBlockValues : undefined)

  const { finalDisabled: isDisabled } = useDependsOnGate(blockId, config, {
    disabled,
    isPreview,
    previewContextValues: contextValues,
  })

  const linkedResource = useMemo(() => {
    const selected = subBlockValues?.[config.id]?.value
    const id =
      typeof selected === 'string' && selected && !selected.startsWith('<') ? selected : null
    if (!id || !workspaceId) return undefined
    if (config.type === 'table-selector')
      return { label: 'View table', href: `${workspacePath(workspaceId, 'tables')}/${id}` }
    if (config.type === 'knowledge-base-selector')
      return {
        label: 'View knowledge base',
        href: `${workspacePath(workspaceId, 'knowledge')}/${id}`,
      }
    return undefined
  }, [config.id, config.type, subBlockValues, workspaceId])

  const openLinkedResource = useCallback(() => {
    if (linkedResource) window.open(linkedResource.href, '_blank', 'noopener')
  }, [linkedResource])

  const renderInput = (): ReactNode => {
    switch (config.type) {
      case 'short-input':
        return (
          <ShortInput
            blockId={blockId}
            subBlockId={config.id}
            placeholder={config.placeholder}
            password={config.password}
            readOnly={config.readOnly}
            useWebhookUrl={config.useWebhookUrl}
            config={config}
            isPreview={isPreview}
            previewValue={previewValue as string | null | undefined}
            disabled={isDisabled}
            wandControlRef={wandControlRef}
          />
        )
      case 'long-input':
        return (
          <LongInput
            blockId={blockId}
            subBlockId={config.id}
            placeholder={config.placeholder}
            password={config.password}
            rows={config.rows}
            config={config}
            isPreview={isPreview}
            previewValue={previewValue as string | null | undefined}
            disabled={isDisabled}
            wandControlRef={wandControlRef}
          />
        )
      case 'dropdown':
        return (
          <Dropdown
            blockId={blockId}
            subBlockId={config.id}
            config={config}
            options={config.options as { label: string; id: string }[]}
            defaultValue={typeof config.value === 'function' ? config.value({}) : config.value}
            placeholder={config.placeholder}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
            multiSelect={config.multiSelect}
            selectorKey={config.selectorKey}
            selectorExcludeSelf={config.selectorExcludeSelf}
            dependsOn={config.dependsOn}
            searchable={config.searchable}
            preserveLabelCase={config.preserveLabelCase}
          />
        )
      case 'table-selector':
        return (
          <TableSelector
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
          />
        )
      case 'combobox':
        return (
          <ComboBox
            blockId={blockId}
            subBlockId={config.id}
            options={config.options as { label: string; id: string }[]}
            defaultValue={typeof config.value === 'function' ? config.value({}) : config.value}
            placeholder={config.placeholder}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
            config={config}
            selectorKey={config.selectorKey}
            selectorExcludeSelf={config.selectorExcludeSelf}
            dependsOn={config.dependsOn}
          />
        )
      case 'slider':
        return (
          <SliderInput
            blockId={blockId}
            subBlockId={config.id}
            label={config.title ?? config.id}
            min={config.min}
            max={config.max}
            defaultValue={(config.min || 0) + ((config.max || 100) - (config.min || 0)) / 2}
            step={config.step}
            integer={config.integer}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'table':
        return (
          <Table
            blockId={blockId}
            subBlockId={config.id}
            columns={config.columns ?? []}
            password={config.password}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'code':
        return (
          <Code
            blockId={blockId}
            subBlockId={config.id}
            placeholder={config.placeholder}
            password={config.password}
            language={config.language}
            value={
              typeof config.value === 'function' ? config.value(subBlockValues || {}) : undefined
            }
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
            readOnly={config.readOnly}
            collapsible={config.collapsible}
            defaultCollapsed={config.defaultCollapsed}
            defaultValue={config.defaultValue}
            showCopyButton={config.showCopyButton}
            onValidationChange={setIsValidJson}
            wandConfig={config.wandConfig || { enabled: false, prompt: '', placeholder: '' }}
            wandControlRef={wandControlRef}
          />
        )
      case 'switch':
        return (
          <SwitchInput
            blockId={blockId}
            subBlockId={config.id}
            title={config.title ?? ''}
            value={typeof config.defaultValue === 'boolean' ? config.defaultValue : undefined}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'tool-input':
        return (
          <ToolInput
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={allowExpandInPreview ? false : isDisabled}
            allowExpandInPreview={allowExpandInPreview}
          />
        )
      case 'skill-input':
        return (
          <SkillInput
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'checkbox-list':
        return (
          <CheckboxList
            blockId={blockId}
            subBlockId={config.id}
            options={
              config.options as {
                label: string
                id: string
                defaultChecked?: boolean
                description?: string
              }[]
            }
            isPreview={isPreview}
            subBlockValues={subBlockValues}
            disabled={isDisabled}
          />
        )
      case 'grouped-checkbox-list':
        return (
          <GroupedCheckboxList
            blockId={blockId}
            subBlockId={config.id}
            options={config.options as { label: string; id: string; group?: string }[]}
            isPreview={isPreview}
            subBlockValues={subBlockValues ?? {}}
            disabled={isDisabled}
          />
        )
      case 'condition-input':
        return (
          <ConditionInput
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'router-input':
        return (
          <ConditionInput
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
            mode='router'
          />
        )
      case 'eval-input':
        return (
          <EvalInput
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'time-input':
        return (
          <TimeInput
            blockId={blockId}
            subBlockId={config.id}
            label={config.title ?? config.id}
            placeholder={config.placeholder}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'file-upload':
        return (
          <FileUpload
            blockId={blockId}
            subBlockId={config.id}
            acceptedTypes={config.acceptedTypes || '*'}
            multiple={config.multiple === true}
            maxSize={config.maxSize}
            requiresCloudStorage={config.requiresCloudStorage === true}
            folderScope={config.folderScope}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'schedule-info':
        return <ScheduleInfo blockId={blockId} isPreview={isPreview} />
      case 'oauth-input':
        return (
          <CredentialSelector
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
            previewContextValues={contextValues}
          />
        )
      case 'file-selector':
      case 'sheet-selector':
      case 'project-selector':
      case 'column-selector':
      case 'document-selector':
        return (
          <SelectorInput
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
            previewContextValues={contextValues}
          />
        )
      case 'folder-selector':
        if (config.resourceType) {
          return (
            <WorkspaceFolderSelector
              blockId={blockId}
              subBlock={config}
              disabled={isDisabled}
              required={isFieldRequired(config, requiredValues)}
              isPreview={isPreview}
              previewValue={previewValue}
            />
          )
        }
        return (
          <SelectorInput
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
            previewContextValues={contextValues}
            overrides={FOLDER_OVERRIDES}
          />
        )
      case 'channel-selector':
      case 'user-selector':
        return (
          <SelectorInput
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
            previewContextValues={contextValues}
            overrides={SLACK_OVERRIDES}
          />
        )
      case 'knowledge-base-selector':
        return (
          <KnowledgeBaseSelector
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
          />
        )
      case 'knowledge-tag-filters':
        return (
          <KnowledgeTagFilters
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
            previewContextValues={contextValues}
          />
        )
      case 'document-tag-entry':
        return (
          <DocumentTagEntry
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
            previewContextValues={contextValues}
          />
        )
      case 'input-format':
        return (
          <InputFormat
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
            config={config}
            showValue
          />
        )
      case 'input-mapping':
        return (
          <InputMapping
            blockId={blockId}
            subBlock={config}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
            previewContextValues={contextValues}
          />
        )
      case 'workflow-input-mapper':
        return (
          <WorkflowInputMapper
            blockId={blockId}
            subBlock={config}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
            contextValues={contextValues}
          />
        )
      case 'variables-input':
        return (
          <VariablesInput
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'response-format':
        return (
          <ResponseFormat
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            config={config}
            disabled={isDisabled}
          />
        )
      case 'filter-builder':
        return (
          <FilterBuilder
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'sort-builder':
        return (
          <SortBuilder
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'workflow-selector':
        return (
          <WorkflowSelectorInput
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
          />
        )
      case 'workflow-output-selector':
        return (
          <WorkflowOutputSelector
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
            placeholder={config.placeholder}
          />
        )
      case 'mcp-server-selector':
        return (
          <McpServerSelector
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
          />
        )
      case 'mcp-tool-selector':
        return (
          <McpToolSelector
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
            previewContextValues={contextValues}
          />
        )
      case 'mcp-dynamic-args':
        return (
          <McpDynamicArgs
            blockId={blockId}
            subBlockId={config.id}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
            previewContextValues={contextValues}
          />
        )
      case 'text':
        return (
          <TextBlock
            blockId={blockId}
            subBlockId={config.id}
            content={
              typeof config.value === 'function'
                ? config.value(subBlockValues || {})
                : (config.defaultValue as string) || ''
            }
          />
        )
      case 'modal': {
        const ModalComponent = config.modalId ? MODAL_REGISTRY[config.modalId] : undefined
        if (!ModalComponent)
          return (
            <p className={styles.unknown} data-type='T060'>
              Unknown modal: {String(config.modalId)}
            </p>
          )
        return <ModalComponent blockId={blockId} isPreview={isPreview} disabled={isDisabled} />
      }
      case 'model-fallback-list':
        return (
          <ModelFallbackList
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            previewPrimary={
              isPreview
                ? {
                    model: subBlockValues?.model?.value,
                    reasoningEffort: subBlockValues?.reasoningEffort?.value,
                    thinkingLevel: subBlockValues?.thinkingLevel?.value,
                    verbosity: subBlockValues?.verbosity?.value,
                  }
                : undefined
            }
            disabled={isDisabled}
          />
        )
      case 'messages-input':
        return (
          <MessagesInput
            blockId={blockId}
            subBlockId={config.id}
            config={config}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
            wandControlRef={wandControlRef}
          />
        )
      default:
        return (
          <p className={styles.unknown} data-type='T060'>
            Unknown input type: {config.type}
          </p>
        )
    }
  }

  return (
    <div
      role='presentation'
      className={styles.subBlock}
      data-workflow-search-subblock-id={config.id}
      data-workflow-search-canonical-id={config.canonicalParamId ?? config.id}
      onMouseDown={stopCanvasDrag}
    >
      <SubBlockLabel
        config={config}
        isValidJson={isValidJson}
        required={isFieldRequired(config, requiredValues)}
        isPreview={isPreview}
        disabled={isDisabled}
        wandControlRef={wandControlRef}
        canonicalToggle={canonicalToggle}
        canonicalToggleDisabled={Boolean(canonicalToggle?.disabled || disabled || isPreview)}
        copyValue={
          config.showCopyButton && (config.useWebhookUrl || config.providerWebhookUrl)
            ? webhookManagement?.webhookUrl
            : undefined
        }
        labelSuffix={labelSuffix}
        linkedResource={
          linkedResource ? { label: linkedResource.label, onOpen: openLinkedResource } : undefined
        }
      />
      {renderInput()}
    </div>
  )
}

export const SubBlock = memo(SubBlockComponent, arePropsEqual)
