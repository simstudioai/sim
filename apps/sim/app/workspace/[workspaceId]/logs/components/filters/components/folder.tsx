import { useEffect, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useFolderStore } from '@/stores/folders/store'
import { useFilterStore } from '@/stores/logs/filters/store'

interface FolderOption {
  id: string
  name: string
  color: string
  path: string // For nested folders, show full path
}

export default function FolderFilter() {
  const { folderIds, toggleFolderId, setFolderIds } = useFilterStore()
  const { getFolderTree, getFolderPath, fetchFolders } = useFolderStore()
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [folders, setFolders] = useState<FolderOption[]>([])
  const [loading, setLoading] = useState(true)

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
        console.error('Failed to fetch folders:', error)
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
        <Button
          variant='outline'
          size='sm'
          className='w-full justify-between rounded-[10px] border-[#E5E5E5] bg-[#FFFFFF] font-normal text-sm dark:border-[#414141] dark:bg-[#202020]'
        >
          {loading ? 'Loading folders...' : getSelectedFoldersText()}
          <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        className='max-h-[300px] w-[200px] overflow-y-auto rounded-lg border-[#E5E5E5] bg-[#FFFFFF] shadow-xs dark:border-[#414141] dark:bg-[#202020]'
      >
        <DropdownMenuItem
          key='all'
          onSelect={(e) => {
            e.preventDefault()
            clearSelections()
          }}
          className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
        >
          <span>All folders</span>
          {folderIds.length === 0 && <Check className='h-4 w-4 text-primary' />}
        </DropdownMenuItem>

        {!loading && folders.length > 0 && <DropdownMenuSeparator />}

        {!loading &&
          folders.map((folder) => (
            <DropdownMenuItem
              key={folder.id}
              onSelect={(e) => {
                e.preventDefault()
                toggleFolderId(folder.id)
              }}
              className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
            >
              <div className='flex items-center'>
                <span className='truncate' title={folder.path}>
                  {folder.path}
                </span>
              </div>
              {isFolderSelected(folder.id) && <Check className='h-4 w-4 text-primary' />}
            </DropdownMenuItem>
          ))}

        {loading && (
          <DropdownMenuItem
            disabled
            className='rounded-md px-3 py-2 font-[380] text-muted-foreground text-sm'
          >
            Loading folders...
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
