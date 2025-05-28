import { useEffect, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

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
  showPreview?: boolean
}

export function LinearProjectSelector({ value, onChange, credential, teamId, label = 'Select Linear project', disabled = false }: LinearProjectSelectorProps) {
  const [projects, setProjects] = useState<LinearProjectInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!credential || !teamId) return
    setLoading(true)
    setError(null)
    fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credential}`,
      },
      body: JSON.stringify({
        query: `query($teamId: String!) { team(id: $teamId) { projects { nodes { id name } } } }`,
        variables: { teamId },
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.errors) {
          setError(data.errors[0].message)
          setProjects([])
        } else {
          setProjects(data.data.team?.projects?.nodes || [])
        }
      })
      .catch((err) => {
        setError(err.message)
        setProjects([])
      })
      .finally(() => setLoading(false))
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