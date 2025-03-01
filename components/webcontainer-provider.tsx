'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { executeCode, getWebContainer } from '@/lib/webcontainer'

// Create a context for WebContainer state and utilities
interface WebContainerContextType {
  isReady: boolean
  error: string | null
  executeFunction: (code: string, params?: Record<string, any>) => Promise<any>
}

const WebContainerContext = createContext<WebContainerContextType>({
  isReady: false,
  error: null,
  executeFunction: async () => ({ success: false, error: 'WebContainer not initialized' }),
})

// Hook to use WebContainer
export const useWebContainer = () => useContext(WebContainerContext)

/**
 * WebContainerProvider initializes the WebContainer API on the client side
 * This component should be included near the root of the application
 */
export function WebContainerProvider({ children }: { children: React.ReactNode }) {
  const [isInitialized, setIsInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isIsolated, setIsIsolated] = useState<boolean | null>(null)

  // Function to execute code directly from client components
  const executeFunction = useCallback(
    async (code: string, params: Record<string, any> = {}) => {
      if (!isInitialized) {
        return {
          success: false,
          output: {},
          error: 'WebContainer not initialized',
        }
      }

      try {
        return await executeCode(code, params)
      } catch (err: any) {
        console.error('WebContainer execution error:', err)
        return {
          success: false,
          output: {},
          error: err.message || 'Error executing function',
        }
      }
    },
    [isInitialized]
  )

  useEffect(() => {
    // Check if we're in a cross-origin isolated context
    if (typeof window !== 'undefined') {
      setIsIsolated(!!window.crossOriginIsolated)
    }

    const initWebContainer = async () => {
      try {
        // Initialize WebContainer when the component mounts
        await getWebContainer()
        setIsInitialized(true)
      } catch (err: any) {
        console.error('Failed to initialize WebContainer:', err)
        setError(err.message || 'Failed to initialize WebContainer')
      }
    }

    // Only try to initialize if we're properly isolated
    if (isIsolated) {
      initWebContainer()
    }
  }, [isIsolated])

  // Provide WebContainer context
  const contextValue = {
    isReady: isInitialized,
    error,
    executeFunction,
  }

  if (error || isIsolated === false) {
    const needsRestart = error?.includes('restart') || !isIsolated

    return (
      <WebContainerContext.Provider value={contextValue}>
        <div className="fixed bottom-4 right-4 max-w-md bg-destructive/90 text-destructive-foreground p-4 rounded-md shadow-lg z-50">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold mb-1">WebContainer Error</h3>
              <p className="text-sm">
                {isIsolated === false
                  ? 'Cross-Origin Isolation is not enabled. WebContainers require COOP/COEP headers.'
                  : error}
              </p>
              {needsRestart && (
                <p className="text-xs mt-2 font-medium">
                  Please restart the server for the COOP/COEP headers to take effect.
                </p>
              )}
              <p className="text-xs mt-2">
                Note: Function blocks will fall back to less secure VM-based execution until this is
                resolved.
              </p>
            </div>
          </div>
        </div>
        {children}
      </WebContainerContext.Provider>
    )
  }

  return (
    <WebContainerContext.Provider value={contextValue}>{children}</WebContainerContext.Provider>
  )
}
