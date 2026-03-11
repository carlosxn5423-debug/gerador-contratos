const { createClient } = require('@supabase/supabase-js')

const url  = process.env.SUPABASE_URL
const key  = process.env.SUPABASE_ANON_KEY

let client = null

function getClient() {
  if (!url || !key) return null
  if (!client) client = createClient(url, key)
  return client
}

module.exports = { getClient }
