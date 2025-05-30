import { useEffect, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface LinearTeamInfo {
  id: string
  name: string
}

interface LinearTeamSelectorProps {
  value: string
  onChange: (teamId: string, teamInfo?: LinearTeamInfo) => void
  credential: string
  label?: string
  disabled?: boolean
  showPreview?: boolean
}

export function LinearTeamSelector({
  value,
  onChange,
  credential,
  label = 'Select Linear team',
  disabled = false,
}: LinearTeamSelectorProps) {
  const [teams, setTeams] = useState<LinearTeamInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!credential) return
    const controller = new AbortController()
    setLoading(true)
    fetch('/api/tools/linear/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (data.error) {
          setError(data.error)
          setTeams([])
        } else {
          setTeams(data.teams)
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setError(err.message)
        setTeams([])
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [credential])

  return (
    <Select
      value={value}
      onValueChange={(teamId) => {
        const teamInfo = teams.find((t) => t.id === teamId)
        onChange(teamId, teamInfo)
      }}
      disabled={disabled || loading || !credential}
    >
      <SelectTrigger className='w-full'>
        <SelectValue placeholder={loading ? 'Loading teams...' : label} />
      </SelectTrigger>
      <SelectContent>
        {teams.map((team) => (
          <SelectItem key={team.id} value={team.id}>
            {team.name}
          </SelectItem>
        ))}
        {error && <div className='px-2 py-1 text-red-500'>{error}</div>}
      </SelectContent>
    </Select>
  )
}
