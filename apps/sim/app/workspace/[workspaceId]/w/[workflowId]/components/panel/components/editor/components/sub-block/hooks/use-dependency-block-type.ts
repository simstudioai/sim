'use client'

import { createContext, use } from 'react'

const DependencyBlockTypeContext = createContext<string | null>(null)

/**
 * Provider set by tool-input param rendering (value = the tool's block type, e.g. `gmail`).
 */
export const DependencyBlockTypeProvider = DependencyBlockTypeContext.Provider

/**
 * The block type whose config should drive dependency (`dependsOn`) canonical resolution
 * for the current subblock. Null for normal blocks (resolve against the host block). Set
 * to the tool's type for tool-input params, so a nested tool's selector resolves its
 * parents against the TOOL's config (e.g. a Gmail tool's `credential` -> `oauthCredential`,
 * which the host Agent block's subblocks don't define) and can fetch its options.
 */
export const useDependencyBlockType = () => use(DependencyBlockTypeContext)
