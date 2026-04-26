import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  // Accept both the documented name (SUPABASE_SERVICE_ROLE_KEY) and the legacy
  // code name (SUPABASE_SERVICE_KEY) so existing Vercel configs don't break.
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

export default supabase;
