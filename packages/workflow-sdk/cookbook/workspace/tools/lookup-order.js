// Each schema parameter is a variable; $env.NAME reads an environment variable by name, so the
// value never appears in source.
const response = await fetch(`https://orders.example.com/api/orders/${encodeURIComponent(orderId)}`, {
  headers: { Authorization: `Bearer ${$env.ORDERS_API_KEY}` },
})
return await response.json()
