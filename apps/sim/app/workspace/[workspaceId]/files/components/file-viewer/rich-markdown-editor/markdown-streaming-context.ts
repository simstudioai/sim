import { createContext } from 'react'

/** True while agent output is streaming into the editor, for node views that render its content. */
export const MarkdownStreamingContext = createContext(false)
