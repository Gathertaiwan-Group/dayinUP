'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import Cart from './Cart'
import Checkout from './Checkout'
import Account from './Account'
import OrderReceived from './OrderReceived'

export default function ClientMount({ component, props }: { component: string; props: any }) {
  if (component === 'cart') return <Cart {...props} />
  if (component === 'checkout') return <Checkout {...props} />
  if (component === 'order-received') return <OrderReceived {...props} />
  if (component === 'account') return <Account {...props} />
  return null
}
