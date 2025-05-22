'use client'

import React from 'react'

export function ChatLoadingState() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="animate-pulse text-center">
        <div className="h-8 w-48 bg-gray-200 rounded mx-auto mb-4"></div>
        <div className="h-4 w-64 bg-gray-200 rounded mx-auto"></div>
      </div>
    </div>
  )
}
