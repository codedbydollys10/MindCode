import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const listAllUsers = async () => {
  const users = [];
  const perPage = 200;
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }

  return users;
};

const main = async () => {
  const users = await listAllUsers();

  let updated = 0;
  let alreadyRecruiter = 0;
  let failed = 0;

  for (const user of users) {
    const metadata = (user.user_metadata && typeof user.user_metadata === 'object') ? user.user_metadata : {};
    if (metadata.role === 'recruiter') {
      alreadyRecruiter += 1;
      continue;
    }

    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...metadata,
        role: 'recruiter',
      },
    });

    if (error) {
      failed += 1;
      console.error(`Failed updating ${user.email || user.id}: ${error.message}`);
      continue;
    }

    updated += 1;
  }

  console.log(JSON.stringify({
    totalUsers: users.length,
    updated,
    alreadyRecruiter,
    failed,
  }, null, 2));

  if (failed > 0) {
    process.exitCode = 2;
  }
};

main().catch((err) => {
  console.error('Migration failed:', err?.message || err);
  process.exit(1);
});
