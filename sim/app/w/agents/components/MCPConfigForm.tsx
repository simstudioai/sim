'use client'

import { useEffect, useState } from 'react'
import { useCoAgent } from '@copilotkit/react-core'
import {
  CirclePlus,
  Dot,
  Globe,
  Plus,
  StoreIcon,
  TerminalSquare,
  TerminalSquareIcon,
  Trash2,
  X,
} from 'lucide-react'
import { useLocalStorage } from '../hooks/useLocalStorage'
import Link from 'next/link'
// import { MarketplacePopup } from '../components/MarketplacePopup'

type ConnectionType = 'stdio' | 'sse'

interface StdioConfig {
  command: string
  args: string[]
  transport: 'stdio'
}

interface SSEConfig {
  url: string
  transport: 'sse'
}

type ServerConfig = StdioConfig | SSEConfig

interface MCPConfigFormProps {
  agentName: string;
}

// Define a generic type for our state
interface AgentState {
  mcp_config: Record<string, ServerConfig>
}

// Function to get storage key for a specific agent
const getStorageKey = (agentName: string) => `mcp-agent-${agentName}`

const ExternalLink = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className="w-3 h-3 ml-1"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
    />
  </svg>
)

export function MCPConfigForm({ agentName }: MCPConfigFormProps) {
  // Use our localStorage hook for persistent storage with agent-specific key
  const [savedConfigs, setSavedConfigs] = useLocalStorage<Record<string, ServerConfig>>(
    getStorageKey(agentName),
    {}
  )

  // Initialize agent state with the data from localStorage
  const { state: agentState, setState: setAgentState } = useCoAgent<AgentState>({
    name: 'sim_agent',
    initialState: {
      mcp_config: savedConfigs,
    },
  })

  // Simple getter for configs
  const configs = agentState?.mcp_config || {}

  // Simple setter wrapper for configs that updates both agent state and local storage
  const setConfigs = (newConfigs: Record<string, ServerConfig>) => {
    setAgentState({ ...agentState, mcp_config: newConfigs })
    setSavedConfigs(newConfigs)
  }

  const [serverName, setServerName] = useState('')
  const [connectionType, setConnectionType] = useState<ConnectionType>('stdio')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [url, setUrl] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [showAddServerForm, setShowAddServerForm] = useState(false)
  const [showExampleConfigs, setShowExampleConfigs] = useState(false)
  const [showMarketplace, setShowMarketplace] = useState(false)

  // Calculate server statistics
  const totalServers = Object.keys(configs).length
  const stdioServers = Object.values(configs).filter(
    (config) => config.transport === 'stdio'
  ).length
  const sseServers = Object.values(configs).filter((config) => config.transport === 'sse').length

  // Set loading to false when state is loaded
  useEffect(() => {
    if (agentState) {
      setIsLoading(false)
    }
  }, [agentState])

  const addConfig = () => {
    if (!serverName) return

    const newConfig =
      connectionType === 'stdio'
        ? {
            command,
            args: args.split(' ').filter((arg) => arg.trim() !== ''),
            transport: 'stdio' as const,
          }
        : {
            url,
            transport: 'sse' as const,
          }

    setConfigs({
      ...configs,
      [serverName]: newConfig,
    })

    // Reset form
    setServerName('')
    setCommand('')
    setArgs('')
    setUrl('')
    setShowAddServerForm(false)
  }

  const removeConfig = (name: string) => {
    const newConfigs = { ...configs }
    delete newConfigs[name]
    setConfigs(newConfigs)
  }

  if (isLoading) {
    return <div className="p-4 animate-pulse text-gray-500">Fetching your servers...</div>
  }

  return (
    <div className="w-full h-screen flex flex-col p-6 bg-background text-zinc-300">
      <header className="mb-4 border-b border-zinc-800 pb-4">
        <div className="grid grid-cols-3 gap-2 w-full">
          {/* Active Servers Card */}
          <div
            className={`${totalServers === 0 ? 'border border-gray-800 rounded-lg p-2' : 'border border-white/40 rounded-lg p-2'}`}
          >
            <div className="flex items-center justify-start mb-3">
              <span
                className={`${totalServers === 0 ? 'text-sm text-zinc-500' : 'text-sm text-white'}`}
              >
                Active Servers
              </span>
            </div>
            <div className="flex">
              <span
                className={`${totalServers === 0 ? 'text-lg text-zinc-500' : 'text-lg text-white'}`}
              >
                {totalServers}
              </span>
            </div>
          </div>
          {/* SSE Servers Card */}
          <div
            className={`${sseServers === 0 ? 'border border-gray-800 rounded-lg p-2' : 'border border-white/40 rounded-lg p-2'}`}
          >
            <div className="flex items-center justify-start mb-3">
              <span
                className={`${sseServers === 0 ? 'text-sm text-zinc-500' : 'text-sm text-white'}`}
              >
                SSE Servers
              </span>
            </div>
            <div className="flex">
              <span
                className={`${sseServers === 0 ? 'text-lg text-zinc-500' : 'text-lg text-white'}`}
              >
                {sseServers}
              </span>
            </div>
          </div>
          {/* Standard/IO Servers Card */}
          <div
            className={`${stdioServers === 0 ? 'border border-gray-800 rounded-lg p-2' : 'border border-white/40 rounded-lg p-2'}`}
          >
            <div className="flex items-center justify-start mb-3">
              <span
                className={`${stdioServers === 0 ? 'text-sm text-zinc-500' : 'text-sm text-white'}`}
              >
                Standard Servers
              </span>
            </div>
            <div className="flex">
              <span
                className={`${stdioServers === 0 ? 'text-lg text-zinc-500' : 'text-lg text-white'}`}
              >
                {stdioServers}
              </span>
            </div>
          </div>
        </div>
      </header>

      {totalServers === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-zinc-600 border border-zinc-800 rounded-md bg-background">
          <p className="text-sm mb-3 text-center">
            No servers connected yet. Add a server or browse the marketplace.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setShowAddServerForm(true)}
              className="px-3 hover:scale-105 transition-all duration-300 cursor-pointer py-1.5 bg-background text-zinc-400 rounded border border-zinc-700 hover:bg-zinc-700 flex items-center gap-1.5 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Server
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          <div className="flex gap-2">
            <button
              onClick={() => setShowAddServerForm(true)}
              className="px-3 flex-1 hover:scale-105 transition-all duration-300 cursor-pointer py-1.5 bg-background text-zinc-400 text-center justify-center rounded border border-zinc-800 hover:bg-zinc-800 flex items-center gap-1.5 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Server
            </button>
          </div>
          {Object.entries(configs).map(([name, config]) => (
            <div
              key={name}
              className="relative p-4 rounded-md border border-zinc-800 bg-zinc-900/30"
            >
              <div className="absolute top-3 right-3">
                <button
                  onClick={() => removeConfig(name)}
                  className="cursor-pointer hover:scale-105 transition-all duration-300"
                >
                  <Trash2 className="w-4 h-4 text-red-500" />
                </button>
              </div>

              <div className="flex flex-col items-start">
                <div className="mb-2 inline-flex items-center px-1.5 py-0.5 rounded-sm text-xs border border-zinc-700 bg-background">
                  {config.transport === 'stdio' ? (
                    <TerminalSquare className="w-3 h-3 mr-1 text-zinc-500" />
                  ) : (
                    <Globe className="w-3 h-3 mr-1 text-zinc-500" />
                  )}
                  <span className=" text-zinc-500">
                    Server Type: <span className="uppercase">{config.transport}</span>
                  </span>
                </div>

                <h3 className="text-sm font-medium text-white mb-1">{name}</h3>

                <div className="text-xs text-zinc-500">
                  {config.transport === 'stdio' ? (
                    <p className="font-mono">{config.command}</p>
                  ) : (
                    <p className="font-mono truncate max-w-[250px]" title={config.url}>
                      {config.url}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddServerForm && (
        <div className="fixed inset-0 bg-background/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-zinc-800">
              <h2 className="text-zinc-300 text-sm font-medium">Add Server</h2>
              <button
                onClick={() => setShowAddServerForm(false)}
                className="text-zinc-500 cursor-pointer hover:scale-105 transition-all duration-300 hover:text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Server Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setConnectionType('stdio')}
                    className={`flex items-center justify-center cursor-pointer px-3 py-2 rounded text-xs ${
                      connectionType === 'stdio'
                        ? 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                        : 'bg-zinc-950 text-zinc-500 border border-zinc-800'
                    }`}
                  >
                    <TerminalSquare className="w-3.5 h-3.5 mr-1.5" />
                    Standard
                  </button>
                  <button
                    type="button"
                    onClick={() => setConnectionType('sse')}
                    className={`flex items-center cursor-pointer justify-center px-3 py-2 rounded text-xs ${
                      connectionType === 'sse'
                        ? 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                        : 'bg-zinc-950 text-zinc-500 border border-zinc-800'
                    }`}
                  >
                    <Globe className="w-3.5 h-3.5 mr-1.5" />
                    SSE
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Server Name</label>
                <input
                  type="text"
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded text-xs px-3 py-2 text-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-700"
                  placeholder="e.g. gmail-service, cal-bot"
                />
              </div>

              {connectionType === 'stdio' ? (
                <>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1.5">Script</label>
                    <input
                      type="text"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded text-xs px-3 py-2 text-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-700"
                      placeholder="e.g. python"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1.5">Arguments</label>
                    <input
                      type="text"
                      value={args}
                      onChange={(e) => setArgs(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded text-xs px-3 py-2 text-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-700"
                      placeholder="e.g. path/to/main.py"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-xs text-zinc-500 mb-1.5">URL</label>
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded text-xs px-3 py-2 text-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-700"
                    placeholder="e.g. https://mcp.composio.dev/gmail"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 p-4 border-t border-zinc-800">
              <button
                onClick={() => setShowAddServerForm(false)}
                className="px-3 py-1.5 cursor-pointer border border-zinc-800 text-zinc-400 rounded text-xs hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                onClick={addConfig}
                className="px-3 py-1.5 cursor-pointer bg-zinc-800 border border-zinc-700 text-zinc-300 rounded text-xs hover:bg-zinc-700"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Marketplace popup */}
      {/* <MarketplacePopup isOpen={showMarketplace} onClose={() => setShowMarketplace(false)} /> */}
    </div>
  )
}
