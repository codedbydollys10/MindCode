import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const filename = fileURLToPath(import.meta.url);
dotenv.config({ path: path.resolve(path.dirname(filename), '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const userId = process.argv[2];

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env');
  process.exit(1);
}

if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
  console.error('Usage: node scripts/grant-teacher-role.mjs <authenticated-user-id>');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const main = async () => {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) throw error;
  if (!data.user) throw new Error(`No authenticated user exists with ID ${userId}.`);

  const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: { ...data.user.app_metadata, role: 'teacher' },
  });
  if (updateError) throw updateError;

  console.log(`Granted teacher role to authenticated user ${userId}. Sign out and sign in again to refresh the role claim.`);
};

main().catch((error) => {
  console.error('Unable to grant teacher role:', error?.message || error);
  process.exitCode = 1;
});
