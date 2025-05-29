import { useEffect, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface LinearProjectInfo {
  id: string
  name: string
}

interface LinearProjectSelectorProps {
  value: string
  onChange: (projectId: string, projectInfo?: LinearProjectInfo) => void
  credential: string
  teamId: string
  label?: string
  disabled?: boolean
}

export function LinearProjectSelector({
  value,
  onChange,
  credential,
  teamId,
  label = 'Select Linear project',
  disabled = false,
}: LinearProjectSelectorProps) {
  const [projects, setProjects] = useState<LinearProjectInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!credential || !teamId) return
    const controller = new AbortController()
    setLoading(true)
    fetch('/api/tools/linear/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential, teamId }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const errorText = await res.text()
          throw new Error(`HTTP error! status: ${res.status} - ${errorText}`)
        }
        return res.json()
      })
      .then((data) => {
        if (data.error) {
          setError(data.error)
          setProjects([])
        } else {
          setProjects(data.projects)
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setError(err.message)
        setProjects([])
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [credential, teamId])

  return (
    <Select
      value={value}
      onValueChange={(projectId) => {
        const projectInfo = projects.find((p) => p.id === projectId)
        onChange(projectId, projectInfo)
      }}
      disabled={disabled || loading || !credential || !teamId}
    >
      <SelectTrigger className='w-full'>
        <SelectValue placeholder={loading ? 'Loading projects...' : label} />
      </SelectTrigger>
      <SelectContent>
        {projects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            {project.name}
          </SelectItem>
        ))}
        {error && <div className='px-2 py-1 text-red-500'>{error}</div>}
      </SelectContent>
    </Select>
  )
}
