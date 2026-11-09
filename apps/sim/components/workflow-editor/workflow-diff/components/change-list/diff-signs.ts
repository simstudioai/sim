/** The three ways a row can differ, shared by every signed row in the change list. */
export type DiffSignKind = 'added' | 'removed' | 'changed'

export const DIFF_SIGN: Record<DiffSignKind, string> = { added: '+', removed: '−', changed: '~' }

export const DIFF_SIGN_CLASS: Record<DiffSignKind, string> = {
  added: 'text-[var(--brand-accent)]',
  removed: 'text-[var(--text-error)]',
  changed: 'text-[var(--warning)]',
}
