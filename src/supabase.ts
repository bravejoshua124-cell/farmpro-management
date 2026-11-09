import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const supabaseReady = Boolean(url && key && !key.includes('PASTE_'))
export const supabase = createClient(
  url || 'https://example.supabase.co',
  key || 'missing-publishable-key'
)