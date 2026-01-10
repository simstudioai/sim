/**
 * Global state for the universal search modal.
 *
 * Centralizing this state in a store allows any component (e.g. sidebar,
 * workflow command list, keyboard shortcuts) to open or close the modal
 * without relying on DOM events or prop drilling.
 */
export interface SearchModalState {
  /** Whether the search modal is currently open. */
  isOpen: boolean
  /**
   * Explicitly set the open state of the modal.
   *
   * @param open - New open state.
   */
  setOpen: (open: boolean) => void
  /**
   * Convenience method to open the modal.
   */
  open: () => void
  /**
   * Convenience method to close the modal.
   */
  close: () => void
}
