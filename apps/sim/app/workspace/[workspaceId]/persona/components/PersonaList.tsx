import { type Persona, PersonaCard } from './PersonaCard'

interface PersonaListProps {
  personas: Persona[]
  onUse?: (persona: Persona) => void
  onAssignWorkflow?: (persona: Persona, workflowName: string) => void
  onConnectPersona?: (persona: Persona, connectToId: string) => void
}

export function PersonaList({
  personas,
  onUse,
  onAssignWorkflow,
  onConnectPersona,
}: PersonaListProps) {
  return (
    <div className='space-y-6'>
      {personas.map((persona) => (
        <PersonaCard
          key={persona.id}
          persona={persona}
          personas={personas}
          onUse={onUse}
          onAssignWorkflow={onAssignWorkflow}
          onConnectPersona={onConnectPersona}
        />
      ))}
    </div>
  )
}
