'use client'

import { ControlBar } from './components/control-bar/control-bar'
import { Filters } from './components/filters/filters'

export default function Logs() {
  return (
    <div className="flex flex-col h-full">
      <ControlBar />
      <div className="flex flex-1 overflow-hidden">
        <Filters />
        <div className="flex-1 overflow-auto p-4">
          {/* Logs content will go here */}
          <div className="text-muted-foreground text-center mt-10">137 total logs found...</div>
        </div>
      </div>
    </div>
  )
}
