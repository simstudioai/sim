import { useEffect, useState } from 'react'
import { Check, ChevronDown, Folder } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useFilterStore } from '@/app/w/logs/stores/store'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface FolderOption {
  id: string
  name: string
  color: string
  path: string // For nested folders, show full path
}

export default function FolderFilter() {
  const { folderIds, toggleFolderId, setFolderIds } = useFilterStore()
  const { getFolderTree, getFolderPath, fetchFolders } = useFolderStore()
  const { activeWorkspaceId } = useWorkflowRegistry()
  const [folders, setFolders] = useState<FolderOption[]>([])
  const [loading, setLoading] = useState(true)

  // Fetch all available folders from the API
  useEffect(() => {
    const fetchFoldersData = async () => {
      try {
        setLoading(true)
        if (activeWorkspaceId) {
          await fetchFolders(activeWorkspaceId)
          const folderTree = getFolderTree(activeWorkspaceId)

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
        console.error('Failed to fetch folders:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchFoldersData()
  }, [activeWorkspaceId, fetchFolders, getFolderTree])

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

  // Add special option for workflows without folders
  const includeRootOption = true

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline' size='sm' className='w-full justify-between font-normal text-sm'>
          {loading ? 'Loading folders...' : getSelectedFoldersText()}
          <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='max-h-[300px] w-[200px] overflow-y-auto'>
        <DropdownMenuItem
          key='all'
          onSelect={(e) => {
            e.preventDefault()
            clearSelections()
          }}
          className='flex cursor-pointer items-center justify-between p-2 text-sm'
        >
          <span>All folders</span>
          {folderIds.length === 0 && <Check className='h-4 w-4 text-primary' />}
        </DropdownMenuItem>

        {/* Option for workflows without folders */}
        {includeRootOption && (
          <DropdownMenuItem
            key='root'
            onSelect={(e) => {
              e.preventDefault()
              toggleFolderId('root')
            }}
            className='flex cursor-pointer items-center justify-between p-2 text-sm'
          >
            <div className='flex items-center'>
              <Folder className='mr-2 h-3 w-3 text-muted-foreground' />
              No folder
            </div>
            {isFolderSelected('root') && <Check className='h-4 w-4 text-primary' />}
          </DropdownMenuItem>
        )}

        {(!loading && folders.length > 0) || includeRootOption ? <DropdownMenuSeparator /> : null}

        {!loading &&
          folders.map((folder) => (
            <DropdownMenuItem
              key={folder.id}
              onSelect={(e) => {
                e.preventDefault()
                toggleFolderId(folder.id)
              }}
              className='flex cursor-pointer items-center justify-between p-2 text-sm'
            >
              <div className='flex items-center'>
                <div
                  className='mr-2 h-2 w-2 rounded-full'
                  style={{ backgroundColor: folder.color }}
                />
                <span className='truncate' title={folder.path}>
                  {folder.path}
                </span>
              </div>
              {isFolderSelected(folder.id) && <Check className='h-4 w-4 text-primary' />}
            </DropdownMenuItem>
          ))}

        {loading && (
          <DropdownMenuItem disabled className='p-2 text-muted-foreground text-sm'>
            Loading folders...
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
