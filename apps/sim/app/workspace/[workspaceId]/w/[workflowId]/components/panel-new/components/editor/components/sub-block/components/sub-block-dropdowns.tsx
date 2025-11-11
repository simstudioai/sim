import { EnvVarDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/env-var-dropdown'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'

/**
 * Props for the SubBlockDropdowns component.
 *
 * @remarks
 * This component renders the tag and env-var dropdowns based on the current state.
 * It should be used in conjunction with the useSubBlockDropdowns hook.
 */
export interface SubBlockDropdownsProps {
  /** Unique identifier for the block */
  blockId: string
  /** Unique identifier for the sub-block */
  subBlockId: string
  /** Whether the dropdowns should be visible at all */
  visible: boolean
  /** Whether env vars dropdown should be shown */
  showEnvVars: boolean
  /** Whether tags dropdown should be shown */
  showTags: boolean
  /** Current search term for env vars */
  searchTerm: string
  /** Current input value */
  inputValue: string
  /** Current cursor position */
  cursorPosition: number
  /** Active source block id for tag filtering */
  activeSourceBlockId: string | null
  /** Ref to the input element for dropdown positioning */
  inputRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>
  /** Workspace id for env var scoping */
  workspaceId: string
  /** Callback when a tag is selected */
  onTagSelect: (newValue: string) => void
  /** Callback when an env var is selected */
  onEnvVarSelect: (newValue: string) => void
  /** Callback when dropdowns should close */
  onClose: () => void
}

/**
 * Renders the tag and env-var dropdowns for sub-block inputs.
 *
 * @remarks
 * This is a presentation component that displays the EnvVarDropdown and TagDropdown
 * components based on the current state. It does not manage state itself; all state
 * should come from the useSubBlockDropdowns hook.
 *
 * @example
 * ```tsx
 * const dropdowns = useSubBlockDropdowns({ blockId, subBlockId, config })
 *
 * <SubBlockDropdowns
 *   blockId={blockId}
 *   subBlockId={subBlockId}
 *   visible={!isPreview && !disabled}
 *   showEnvVars={dropdowns.showEnvVars}
 *   showTags={dropdowns.showTags}
 *   searchTerm={dropdowns.searchTerm}
 *   inputValue={dropdowns.inputValue}
 *   cursorPosition={dropdowns.cursorPosition}
 *   activeSourceBlockId={dropdowns.activeSourceBlockId}
 *   inputRef={dropdowns.inputRef}
 *   workspaceId={dropdowns.workspaceId}
 *   onTagSelect={(newValue) => dropdowns.handleTagSelect(newValue, onChange)}
 *   onEnvVarSelect={(newValue) => dropdowns.handleEnvVarSelect(newValue, onChange)}
 *   onClose={handleClose}
 * />
 * ```
 */
export function SubBlockDropdowns({
  blockId,
  subBlockId,
  visible,
  showEnvVars,
  showTags,
  searchTerm,
  inputValue,
  cursorPosition,
  activeSourceBlockId,
  inputRef,
  workspaceId,
  onTagSelect,
  onEnvVarSelect,
  onClose,
}: SubBlockDropdownsProps): React.ReactElement | null {
  if (!visible) return null

  return (
    <>
      <EnvVarDropdown
        visible={showEnvVars}
        onSelect={onEnvVarSelect}
        searchTerm={searchTerm}
        inputValue={inputValue}
        cursorPosition={cursorPosition}
        workspaceId={workspaceId}
        onClose={onClose}
        maxHeight='192px'
        inputRef={inputRef as React.RefObject<HTMLTextAreaElement | HTMLInputElement>}
      />
      <TagDropdown
        visible={showTags}
        onSelect={onTagSelect}
        blockId={blockId}
        activeSourceBlockId={activeSourceBlockId}
        inputValue={inputValue}
        cursorPosition={cursorPosition}
        onClose={onClose}
        inputRef={inputRef as React.RefObject<HTMLTextAreaElement | HTMLInputElement>}
      />
    </>
  )
}
