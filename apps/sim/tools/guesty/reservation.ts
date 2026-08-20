import type { ToolConfig } from '../types'
import type { GuestyReservationParams, GuestyReservationResponse } from './types'

export const guestyReservationTool: ToolConfig<GuestyReservationParams, GuestyReservationResponse> =
  {
    id: 'guesty_reservation',
    name: 'Guesty Reservation',
    description: 'Fetch reservation details from Guesty by reservation ID',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        requiredForToolCall: true,
        description: 'Your Guesty API token',
      },
      reservationId: {
        type: 'string',
        required: true,
        description: 'The ID of the reservation to fetch',
      },
    },

    request: {
      url: (params: GuestyReservationParams) =>
        `https://open-api.guesty.com/v1/reservations/${params.reservationId}`,
      method: 'GET',
      headers: (params: GuestyReservationParams) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch reservation from Guesty')
      }

      return {
        success: true,
        output: {
          id: data.id,
          guest: {
            fullName: data.guest?.fullName || 'N/A',
            email: data.guest?.email || 'N/A',
            phone: data.guest?.phone || 'N/A',
          },
          checkIn: data.checkIn || 'N/A',
          checkOut: data.checkOut || 'N/A',
          status: data.status || 'N/A',
          listing: {
            id: data.listing?.id || 'N/A',
            title: data.listing?.title || 'N/A',
          },
          money: {
            totalPaid: data.money?.totalPaid || 0,
            currency: data.money?.currency || 'USD',
          },
        },
      }
    },

    transformError: (error: any) => {
      const message = error.message || 'Failed to fetch reservation from Guesty'
      return message
    },
  }
