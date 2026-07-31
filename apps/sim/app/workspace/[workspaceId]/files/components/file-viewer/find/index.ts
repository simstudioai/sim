export {
  FileFindProvider,
  type FindControllerFactory,
  useFileFind,
  useRegisterFindController,
} from './find-context'
export { buildFindRegex, escapeRegExp, findMatches, findRanges } from './find-matches'
export { createMonacoFindController } from './monaco-find-controller'
export {
  DEFAULT_FIND_FLAGS,
  EMPTY_FIND_RESULT,
  FIND_PRIORITY,
  type FindController,
  type FindFlags,
  type FindResult,
  type FindResultReporter,
} from './types'
export { useDomFindController } from './use-dom-find'
