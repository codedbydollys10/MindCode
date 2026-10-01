import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const requiredColumns = {
  collaboration_rooms: 'id, room_code, created_by, teacher_id, invite_hash, language, room_type, content_state, created_at, updated_at',
  collaboration_room_members: 'room_id, user_id, role, joined_at',
  collaboration_room_join_requests: 'id, room_id, user_id, status, requested_at',
  collaboration_room_teacher_invites: 'id, room_id, token_hash, invited_by, expires_at, redeemed_at, redeemed_by',
  collaboration_room_feedback: 'id, room_id, author_id, message, line_number, created_at',
  collaboration_assignments: 'room_id, room_name, title, teacher_name, instructions, deadline, created_at',
  collaboration_assignment_workspaces: 'id, room_id, user_id, content_state, saved_code, saved_at, updated_at',
  collaboration_assignment_progress: 'room_id, user_id, code_runs, attempts, errors, submission_status, submitted_at, updated_at',
  collaboration_assignment_submissions: 'id, room_id, assignment_id, workspace_id, user_id, code, status, attempt, submitted_at',
  collaboration_assignment_runs: 'id, room_id, user_id, has_error, ran_at',
  collaboration_assignment_feedback_requests: 'id, room_id, user_id, message, status, requested_at',
  collaboration_assignment_feedback: 'id, room_id, user_id, author_id, message, concept, is_read, created_at',
};

let hasMissingSchema = false;
for (const [table, columns] of Object.entries(requiredColumns)) {
  const names = columns.split(',').map((column) => column.trim());
  const { error: tableError } = await supabase.from(table).select(names[0]).limit(0);
  if (tableError) {
    hasMissingSchema = true;
    console.error(`MISSING TABLE ${table}: ${tableError.code || 'unknown'} ${tableError.message}`);
    continue;
  }

  const missingColumns = [];
  for (const column of names.slice(1)) {
    const { error } = await supabase.from(table).select(column).limit(0);
    if (error) missingColumns.push(`${column} (${error.code || 'unknown'})`);
  }

  if (missingColumns.length) {
    hasMissingSchema = true;
    console.error(`MISSING COLUMNS ${table}: ${missingColumns.join(', ')}`);
  } else {
    console.log(`OK ${table}`);
  }
}

if (hasMissingSchema) {
  console.error('Collaboration schema verification failed. Apply frontend/migrations/20261001_teacher_assignments.sql.');
  process.exitCode = 1;
} else {
  console.log('Collaboration schema verification passed.');
}
