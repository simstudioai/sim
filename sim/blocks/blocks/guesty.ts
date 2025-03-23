import { GuestyIcon } from '@/components/icons'
import { GuestyGuestResponse } from '@/tools/guesty/guest'
import { GuestyReservationResponse } from '@/tools/guesty/reservation'
import { BlockConfig } from '../types'

export const GuestyBlock: BlockConfig<GuestyReservationResponse | GuestyGuestResponse> = {
  type: 'guesty',
  name: 'Guesty',
  description: 'Interact with Guesty property management system',
  longDescription:
    'Access Guesty property management data including reservations and guest information. Retrieve reservation details by ID or search for guests by phone number.',
  category: 'tools',
  bgColor: '#0051F8', // Guesty brand color
  icon: GuestyIcon,
  subBlocks: [
    {
      id: 'action',
      title: 'Action',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Get Reservation', id: 'reservation' },
        { label: 'Search Guest', id: 'guest' },
      ],
    },
    {
      id: 'reservationId',
      title: 'Reservation ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter reservation ID',
      condition: {
        field: 'action',
        value: 'reservation',
      },
    },
    {
      id: 'phoneNumber',
      title: 'Phone Number',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter phone number',
      condition: {
        field: 'action',
        value: 'guest',
      },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Guesty API key',
      password: true,
      connectionDroppable: false,
    },
  ],
  tools: {
    access: ['guesty_reservation', 'guesty_guest'],
    config: {
      tool: (params) => {
        return params.action === 'reservation' ? 'guesty_reservation' : 'guesty_guest'
      },
      params: (params) => {
        if (params.action === 'reservation') {
          return {
            apiKey: params.apiKey,
            reservationId: params.reservationId,
          }
        } else {
          return {
            apiKey: params.apiKey,
            phoneNumber: params.phoneNumber,
          }
        }
      },
    },
  },
  inputs: {
    action: { type: 'string', required: true },
    apiKey: { type: 'string', required: true },
    reservationId: { type: 'string', required: false },
    phoneNumber: { type: 'string', required: false },
  },
  outputs: {
    response: {
      type: {
        id: 'string',
        guest: 'json',
        checkIn: 'string',
        checkOut: 'string',
        status: 'string',
        listing: 'json',
        money: 'json',
        guests: 'json',
      },
    },
  },
}
