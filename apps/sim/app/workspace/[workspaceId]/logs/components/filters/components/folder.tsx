import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/emcn'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createLogger } from '@/lib/logs/console/logger'
import {
  commandListClass,
  dropdownContentClass,
  filterButtonClass,
  folderDropdownListStyle,
} from '@/app/workspace/[workspaceId]/logs/components/filters/components/shared'
import { useFolderStore } from '@/stores/folders/store'
import { useFilterStore } from '@/stores/logs/filters/store'

const logger = createLogger('LogsFolderFilter')

interface FolderOption {
  id: string
  name: string
  color: string
  path: string // For nested folders, show full path
}

export default function FolderFilter() {
  const { folderIds, toggleFolderId, setFolderIds } = useFilterStore()
  const { getFolderTree, fetchFolders } = useFolderStore()
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [folders, setFolders] = useState<FolderOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Fetch all available folders from the API
  useEffect(() => {
    const fetchFoldersData = async () => {
      try {
        setLoading(true)
        if (workspaceId) {
          await fetchFolders(workspaceId)
          const folderTree = getFolderTree(workspaceId)

          // Flatten the folder tree and create options with full paths
          const flattenFolders = (nodes: any[], parentPath = ''): FolderOption[] => {
            const result: FolderOption[] = []

            for (const node of nodes) {
              const currentPath = parentPath ? `${parentPath} / ${node.name}` : node.name
              result.push({
                id: node.id,
                name: node.name,
                color: node.color || '#6B7280',
                path: currentPath,
              })

              // Add children recursively
              if (node.children && node.children.length > 0) {
                result.push(...flattenFolders(node.children, currentPath))
              }
            }

            return result
          }

          const folderOptions = flattenFolders(folderTree)
          setFolders(folderOptions)
        }
      } catch (error) {
        logger.error('Failed to fetch folders', { error })
      } finally {
        setLoading(false)
      }
    }

    fetchFoldersData()
  }, [workspaceId, fetchFolders, getFolderTree])

  // Get display text for the dropdown button
  const getSelectedFoldersText = () => {
    if (folderIds.length === 0) return 'All folders'
    if (folderIds.length === 1) {
      const selected = folders.find((f) => f.id === folderIds[0])
      return selected ? selected.name : 'All folders'
    }
    return `${folderIds.length} folders selected`
  }

  // Check if a folder is selected
  const isFolderSelected = (folderId: string) => {
    return folderIds.includes(folderId)
  }

  // Clear all selections
  const clearSelections = () => {
    setFolderIds([])
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline' className={filterButtonClass}>
          {loading ? 'Loading folders...' : getSelectedFoldersText()}
          <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        side='bottom'
        avoidCollisions={false}
        sideOffset={4}
        className={dropdownContentClass}
      >
        <Command>
          <CommandInput placeholder='Search folders...' onValueChange={(v) => setSearch(v)} />
          <CommandList className={commandListClass} style={folderDropdownListStyle}>
            <CommandEmpty>{loading ? 'Loading folders...' : 'No folders found.'}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value='all-folders'
                onSelect={() => {
                  clearSelections()
                }}
                className='cursor-pointer'
              >
                <span>All folders</span>
                {folderIds.length === 0 && (
                  <Check className='ml-auto h-4 w-4 text-muted-foreground' />
                )}
              </CommandItem>
              {useMemo(() => {
                const q = search.trim().toLowerCase()
                const filtered = q
                  ? folders.filter((f) => (f.path || f.name).toLowerCase().includes(q))
                  : folders
                return filtered.map((folder) => (
                  <CommandItem
                    key={folder.id}
                    value={`${folder.path || folder.name}`}
                    onSelect={() => {
                      toggleFolderId(folder.id)
                    }}
                    className='cursor-pointer'
                  >
                    <div className='flex items-center'>
                      <span className='truncate' title={folder.path}>
                        {folder.path}
                      </span>
                    </div>
                    {isFolderSelected(folder.id) && (
                      <Check className='ml-auto h-4 w-4 text-muted-foreground' />
                    )}
                  </CommandItem>
                ))
              }, [folders, search, folderIds])}
            </CommandGroup>
          </CommandList>
        </Command>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
