/**
 * Chrome the interface grid shares, so a module's header and the content
 * beneath it line up instead of each carrying whatever padding its own
 * implementation happened to bring.
 *
 * Pure strings — no React — so both the renderers and the canvas can read them.
 */

/**
 * The horizontal gutter the module frame and its plain-content modules use.
 *
 * `px-4` rather than a smaller value because it is the gutter the chat
 * transcript already has: `ClientChatMessage` is shared with the deployed chat
 * page, so its `px-4` is the one value here that cannot be changed without
 * touching a surface outside interfaces. The cell's header bar, the chat
 * composer, the form, and the chooser column are all aligned to it.
 *
 * **Modules that own their own interface do not take this.** A table renders
 * the EMCN `Table`, and a file renders `FileView` — both bring padding that a
 * dozen other surfaces already depend on, and re-gutter­ing them here would
 * either fight those components or drift from them the next time they change.
 * Their frame still lines up, because the frame is the header bar; only their
 * interior keeps its own rhythm.
 */
export const MODULE_GUTTER_X = 'px-4'
