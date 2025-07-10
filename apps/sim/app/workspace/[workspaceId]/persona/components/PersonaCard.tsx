'use client'
import { useState } from 'react'
import { AgentIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'

export interface Persona {
  id: string
  name: string
  photo: string
  description: string
  workflows: { id: string; name: string; status: string }[]
  connectedPersonas: string[]
}

interface PersonaCardProps {
  persona: Persona
  personas: Persona[]
  onUse?: (persona: Persona) => void
  onAssignWorkflow?: (persona: Persona, workflowName: string) => void
  onConnectPersona?: (persona: Persona, connectToId: string) => void
}

export function PersonaCard({
  persona,
  personas,
  onUse,
  onAssignWorkflow,
  onConnectPersona,
}: PersonaCardProps) {
  const allDone =
    persona.workflows.length > 0 && persona.workflows.every((wf) => wf.status === 'done')
  const [workflowName, setWorkflowName] = useState('')
  const [connectToId, setConnectToId] = useState('')

  return (
    <div className='flex flex-col gap-2 rounded border p-4'>
      <div className='flex items-center gap-4'>
        {persona.photo ? (
          <img
            src={persona.photo}
            alt={persona.name}
            className='h-12 w-12 rounded-full object-cover'
          />
        ) : (
          <AgentIcon className='h-12 w-12 text-muted-foreground' />
        )}
        <div>
          <div className='font-semibold text-lg'>{persona.name}</div>
          <div className='text-muted-foreground'>{persona.description}</div>
        </div>
        <div className='ml-auto flex gap-2'>
          <Button onClick={() => onUse?.(persona)}>Use Persona</Button>
        </div>
      </div>
      <div className='mt-2 flex flex-wrap gap-2'>
        <div>
          <span className='font-medium'>Workflows:</span>
          <ul className='ml-2 inline'>
            {persona.workflows.map((wf) => (
              <li key={wf.id} className='mr-2 inline-block'>
                <span className='rounded bg-accent px-2 py-1 text-xs'>
                  {wf.name} <span className='italic'>({wf.status})</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (workflowName && onAssignWorkflow) onAssignWorkflow(persona, workflowName)
            setWorkflowName('')
          }}
          className='flex items-center gap-2'
        >
          <input
            className='rounded border px-2 py-1 text-xs'
            placeholder='Workflow name'
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
          />
          <Button type='submit' size='sm' variant='outline'>
            Assign Workflow
          </Button>
        </form>
        <div>
          <span className='font-medium'>Connected Personas:</span>
          <ul className='ml-2 inline'>
            {persona.connectedPersonas.map((id) => {
              const a = personas.find((p) => p.id === id)
              return a ? (
                <li key={id} className='mr-2 inline-block'>
                  <span className='rounded bg-secondary px-2 py-1 text-xs'>{a.name}</span>
                </li>
              ) : null
            })}
          </ul>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (connectToId && onConnectPersona) onConnectPersona(persona, connectToId)
            setConnectToId('')
          }}
          className='flex items-center gap-2'
        >
          <select
            className='rounded border px-2 py-1 text-xs'
            value={connectToId}
            onChange={(e) => setConnectToId(e.target.value)}
          >
            <option value=''>Connect to...</option>
            {personas
              .filter((a) => a.id !== persona.id && !persona.connectedPersonas.includes(a.id))
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
          <Button type='submit' size='sm' variant='outline'>
            Connect Persona
          </Button>
        </form>
      </div>
      {allDone ? (
        <div className='mt-2 rounded border border-green-200 bg-green-50 p-2'>
          <span className='font-semibold text-green-700'>Report:</span> All workflows completed.
          (Laporan otomatis di sini)
        </div>
      ) : (
        <div className='mt-2 text-muted-foreground text-sm'>
          Status:{' '}
          {persona.workflows.some((wf) => wf.status === 'in progress') ? 'In Progress' : 'Idle'}
        </div>
      )}
    </div>
  )
}
