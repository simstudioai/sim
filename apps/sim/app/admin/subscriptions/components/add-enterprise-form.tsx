'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface AddEnterpriseFormProps {
  onSuccess: () => void
  onError: (message: string) => void
}

export function AddEnterpriseForm({ onSuccess, onError }: AddEnterpriseFormProps) {
  const [userId, setUserId] = useState('')
  const [seats, setSeats] = useState('100')
  const [perSeatAllowance, setPerSeatAllowance] = useState('200')
  const [creating, setCreating] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!userId.trim()) {
      onError('Please enter a user ID')
      return
    }

    try {
      setCreating(true)

      // Get admin auth token
      const token = sessionStorage.getItem('admin-auth-token') || ''
      if (!token) {
        throw new Error('Authentication token missing')
      }

      const seatsValue = parseInt(seats)
      const allowanceValue = parseInt(perSeatAllowance)

      // Calculate total allowance by multiplying seats by per-seat allowance
      const totalAllowance = seatsValue * allowanceValue

      // Use the consolidated API endpoint with enterprise plan
      const response = await fetch('/api/admin/subscriptions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          referenceId: userId,
          seats: seatsValue,
          perSeatAllowance: allowanceValue,
          totalAllowance: totalAllowance,
          plan: 'enterprise',
          metadata: {
            perSeatAllowance: allowanceValue,
            totalAllowance: totalAllowance,
            updatedAt: new Date().toISOString(),
          },
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to create subscription')
      }

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.message || 'Failed to create enterprise subscription')
      }

      onSuccess()

      // Reset form
      setUserId('')
      setSeats('100')
      setPerSeatAllowance('200')
    } catch (error) {
      console.error('Error creating subscription:', error)
      onError(error instanceof Error ? error.message : 'Failed to create enterprise subscription')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add Enterprise Subscription</CardTitle>
        <CardDescription>
          Create a new enterprise subscription for a user or organization.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="userId">User ID</Label>
            <Input
              id="userId"
              placeholder="Enter user or organization ID"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="seats">Seats</Label>
            <Input
              id="seats"
              type="number"
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
              min="1"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="perSeatAllowance">Per-Seat Allowance ($)</Label>
            <Input
              id="perSeatAllowance"
              type="number"
              value={perSeatAllowance}
              onChange={(e) => setPerSeatAllowance(e.target.value)}
              min="1"
              required
            />
            <p className="text-xs text-muted-foreground">
              Total allowance: ${parseInt(seats) * parseInt(perSeatAllowance || '0')}
            </p>
          </div>

          <Button type="submit" className="w-full" disabled={creating}>
            {creating ? 'Creating...' : 'Create Enterprise Subscription'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
