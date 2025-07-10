'use client'
import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { AgentIcon } from '@/components/icons'

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

export function PersonaCard({ persona, personas, onUse, onAssignWorkflow, onConnectPersona }: PersonaCardProps) {
  const allDone = persona.workflows.length > 0 && persona.workflows.every(wf => wf.status === 'done')
  const [workflowName, setWorkflowName] = useState('')
  const [connectToId, setConnectToId] = useState('')

  return (
    <div className='border rounded p-4 flex flex-col gap-2'>
      <div className='flex items-center gap-4'>
        {persona.photo ? (
          <img src={persona.photo} alt={persona.name} className='w-12 h-12 rounded-full object-cover' />
        ) : (
          <AgentIcon className='w-12 h-12 text-muted-foreground' />
        )}
        <div>
          <div className='font-semibold text-lg'>{persona.name}</div>
          <div className='text-muted-foreground'>{persona.description}</div>
        </div>
        <div className='ml-auto flex gap-2'>
          <Button onClick={() => onUse?.(persona)}>Use Persona</Button>
        </div>
      </div>
      <div className='flex flex-wrap gap-2 mt-2'>
        <div>
          <span className='font-medium'>Workflows:</span>
          <ul className='ml-2 inline'>
            {persona.workflows.map((wf) => (
              <li key={wf.id} className='inline-block mr-2'>
                <span className='px-2 py-1 rounded bg-accent text-xs'>
                  {wf.name} <span className='italic'>({wf.status})</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <form
          onSubmit={e => {
            e.preventDefault()
            if (workflowName && onAssignWorkflow) onAssignWorkflow(persona, workflowName)
            setWorkflowName('')
          }}
          className='flex items-center gap-2'
        >
          <input
            className='border rounded px-2 py-1 text-xs'
            placeholder='Workflow name'
            value={workflowName}
            onChange={e => setWorkflowName(e.target.value)}
          />
          <Button type='submit' size='sm' variant='outline'>Assign Workflow</Button>
        </form>
        <div>
          <span className='font-medium'>Connected Personas:</span>
          <ul className='ml-2 inline'>
            {persona.connectedPersonas.map((id) => {
              const a = personas.find((p) => p.id === id)
              return a ? (
                <li key={id} className='inline-block mr-2'>
                  <span className='px-2 py-1 rounded bg-secondary text-xs'>{a.name}</span>
                </li>
              ) : null
            })}
          </ul>
        </div>
        <form
          onSubmit={e => {
            e.preventDefault()
            if (connectToId && onConnectPersona) onConnectPersona(persona, connectToId)
            setConnectToId('')
          }}
          className='flex items-center gap-2'
        >
          <select
            className='border rounded px-2 py-1 text-xs'
            value={connectToId}
            onChange={e => setConnectToId(e.target.value)}
          >
            <option value=''>Connect to...</option>
            {personas.filter(a => a.id !== persona.id && !persona.connectedPersonas.includes(a.id)).map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <Button type='submit' size='sm' variant='outline'>Connect Persona</Button>
        </form>
      </div>
      {allDone ? (
        <div className='mt-2 p-2 bg-green-50 border border-green-200 rounded'>
          <span className='font-semibold text-green-700'>Report:</span> All workflows completed. (Laporan otomatis di sini)
        </div>
      ) : (
        <div className='mt-2 text-sm text-muted-foreground'>
          Status: {persona.workflows.some(wf => wf.status === 'in progress') ? 'In Progress' : 'Idle'}
        </div>
      )}
    </div>
  )
} 