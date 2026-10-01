-- Run this in the Supabase SQL editor for your project.
-- It creates your app tables and enables RLS so the frontend (anon key) can
-- safely write the authenticated user's row into public.users.

-- USERS -------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  email text unique not null,
  headline text,
  location text,
  about text,
  preferred_language text,
  difficulty_bias text,
  github_url text,
  linkedin_url text,
  photo_data text,
  avatar_path text,
  created_at timestamptz default now()
);

alter table public.users add column if not exists headline text;
alter table public.users add column if not exists location text;
alter table public.users add column if not exists about text;
alter table public.users add column if not exists preferred_language text;
alter table public.users add column if not exists difficulty_bias text;
alter table public.users add column if not exists github_url text;
alter table public.users add column if not exists linkedin_url text;
alter table public.users add column if not exists photo_data text;
alter table public.users add column if not exists avatar_path text;

alter table public.users enable row level security;
drop policy if exists "users insert own row" on public.users;
create policy "users insert own row" on public.users
  for insert with check (auth.uid() = id);
drop policy if exists "users select own row" on public.users;
create policy "users select own row" on public.users
  for select using (auth.uid() = id);
drop policy if exists "users update own row" on public.users;
create policy "users update own row" on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Private avatar objects are stored under {authenticated-user-id}/{file-name}.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatars_select_own on storage.objects;
create policy avatars_select_own on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_owner_scope_guard on storage.objects;
create policy avatars_owner_scope_guard on storage.objects as restrictive for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- SKILL TESTS -------------------------------------------------------
create table if not exists public.skill_tests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  language text,
  question text not null,
  topic text,
  difficulty text check (difficulty in ('low','medium','high')),
  starter_code text,
  expected_output text,
  test_cases jsonb,
  created_at timestamptz default now()
);

alter table public.skill_tests add column if not exists language text;

-- SUBMISSIONS -------------------------------------------------------
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid references public.skill_tests(id) on delete set null,
  user_id uuid references public.users(id) on delete cascade,
  code text,
  language text,
  output text,
  error text,
  passed boolean,
  execution_time float,
  created_at timestamptz default now()
);

-- KEYSTROKE LOGS ----------------------------------------------------
create table if not exists public.keystroke_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  test_id uuid references public.skill_tests(id) on delete set null,
  timestamp timestamptz default now(),
  typing_speed float,
  pause_duration float,
  backspace_count int,
  cursor_position int,
  code_snapshot text,
  burst_insert_detected boolean default false,
  is_paste_event boolean default false
);


-- FACIAL DATA -------------------------------------------------------
create table if not exists public.emotion_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  test_id uuid references public.skill_tests(id) on delete set null,
  timestamp timestamptz default now(),
  emotion text,
  confidence float
);

-- REPORTS -----------------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  test_id uuid references public.skill_tests(id) on delete set null,
  problem_breakdown_score float,
  debugging_score float,
  focus_score float,
  planning_score float,
  flexibility_score float,
  heatmap_data jsonb,
  summary text,
  created_at timestamptz default now()
);

-- RECOMMENDATIONS ---------------------------------------------------
create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  test_id uuid references public.skill_tests(id) on delete set null,
  weak_areas text[],
  recommended_topics text[],
  recommended_questions jsonb,
  ai_feedback text,
  created_at timestamptz default now()
);

-- Minimal RLS for read-only access to tests. Adjust as needed.
alter table public.skill_tests enable row level security;
alter table public.submissions enable row level security;
alter table public.keystroke_logs enable row level security;
alter table public.emotion_logs enable row level security;
alter table public.reports enable row level security;
alter table public.recommendations enable row level security;

-- Let authenticated users see tests and their own work. Expand to collaborators if needed.
drop policy if exists "skill_tests readable" on public.skill_tests;
create policy "skill_tests readable" on public.skill_tests
  for select using (true);

drop policy if exists "submissions own" on public.submissions;
create policy "submissions own" on public.submissions
  for select using (auth.uid() = user_id);
drop policy if exists "keystrokes own" on public.keystroke_logs;
create policy "keystrokes own" on public.keystroke_logs
  for select using (auth.uid() = user_id);
drop policy if exists "emotion own" on public.emotion_logs;
create policy "emotion own" on public.emotion_logs
  for select using (auth.uid() = user_id);
drop policy if exists "reports own" on public.reports;
create policy "reports own" on public.reports
  for select using (auth.uid() = user_id);
drop policy if exists "recommendations own" on public.recommendations;
create policy "recommendations own" on public.recommendations
  for select using (auth.uid() = user_id);

-- For inserts from the frontend, allow only the owner to write their rows.
drop policy if exists "submissions insert own" on public.submissions;
create policy "submissions insert own" on public.submissions
  for insert with check (auth.uid() = user_id);
drop policy if exists "submissions insert service" on public.submissions;
create policy "submissions insert service" on public.submissions
  for insert with check (true);
drop policy if exists "keystrokes insert own" on public.keystroke_logs;
create policy "keystrokes insert own" on public.keystroke_logs
  for insert with check (auth.uid() = user_id);
drop policy if exists "keystrokes insert service" on public.keystroke_logs;
create policy "keystrokes insert service" on public.keystroke_logs
  for insert with check (true);
drop policy if exists "emotion insert own" on public.emotion_logs;
create policy "emotion insert own" on public.emotion_logs
  for insert with check (auth.uid() = user_id);
drop policy if exists "emotion insert service" on public.emotion_logs;
create policy "emotion insert service" on public.emotion_logs
  for insert with check (true);
drop policy if exists "reports insert own" on public.reports;
create policy "reports insert own" on public.reports
  for insert with check (auth.uid() = user_id);
drop policy if exists "reports insert service" on public.reports;
create policy "reports insert service" on public.reports
  for insert with check (true);
drop policy if exists "recommendations insert own" on public.recommendations;
create policy "recommendations insert own" on public.recommendations
  for insert with check (auth.uid() = user_id);
drop policy if exists "recommendations insert service" on public.recommendations;
create policy "recommendations insert service" on public.recommendations
  for insert with check (true);

-- ═══════════════════════════════════════════════════════════════
-- BEHAVIORAL INTELLIGENCE ENGINE — SCHEMA ADDITIONS
-- Run these in Supabase SQL editor after the base schema
-- ═══════════════════════════════════════════════════════════════

-- Make test_id nullable for submissions and keystroke_logs to allow graceful fallback
alter table public.submissions drop constraint if exists submissions_test_id_fkey;
alter table public.submissions add constraint submissions_test_id_fkey 
  foreign key (test_id) references public.skill_tests(id) on delete set null;

alter table public.keystroke_logs drop constraint if exists keystroke_logs_test_id_fkey;
alter table public.keystroke_logs add constraint keystroke_logs_test_id_fkey 
  foreign key (test_id) references public.skill_tests(id) on delete set null;

-- KEYSTROKE LOGS: add line_number + word_count if missing
alter table public.keystroke_logs add column if not exists line_number integer;
alter table public.keystroke_logs add column if not exists word_count integer;
alter table public.keystroke_logs add column if not exists action_type text;
alter table public.keystroke_logs add column if not exists code_length integer;
alter table public.keystroke_logs add column if not exists prev_line_number integer;
alter table public.keystroke_logs add column if not exists line_time_ms float;
alter table public.keystroke_logs add column if not exists idle_ms float;
alter table public.keystroke_logs add column if not exists key_pressed text;
alter table public.keystroke_logs add column if not exists paste_detected boolean default false;
alter table public.keystroke_logs add column if not exists pasted_char_count integer;
alter table public.keystroke_logs add column if not exists pasted_line_count integer;
alter table public.keystroke_logs add column if not exists typing_speed float;
alter table public.keystroke_logs add column if not exists cursor_position integer;
alter table public.keystroke_logs add column if not exists sudden_code_jump boolean default false;

-- BEHAVIOR BLOCKS TABLE — Enhanced behavioral intelligence
-- Tracks comprehensive behavioral patterns at the block/chunk level
create table if not exists public.behavior_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  test_id uuid references public.skill_tests(id) on delete set null,
  timestamp timestamptz default now(),
  
  -- Keystroke metrics
  keystroke_count integer default 0,
  backspace_count integer default 0,
  pause_duration_ms float default 0,
  typing_speed_avg float,
  
  -- Copy-paste detection
  paste_detected boolean default false,
  pasted_char_count integer default 0,
  pasted_line_count integer default 0,
  
  -- Idle time & hesitation
  idle_ms float default 0,
  hesitation_count integer default 0,
  
  -- Error patterns
  error_count integer default 0,
  error_recovery_time_ms float,
  
  -- Code rewrite patterns
  line_rewrites integer default 0,
  code_rewrite_count integer default 0,
  deletion_bursts integer default 0,
  
  -- Context
  code_snapshot text,
  block_duration_ms float,
  focus_level float,
  is_completing boolean default false
);

-- Performance indexes on behavior_blocks
create index if not exists idx_behavior_blocks_user_test on public.behavior_blocks(user_id, test_id);
create index if not exists idx_behavior_blocks_timestamp on public.behavior_blocks(timestamp);

-- RLS Policies for behavior_blocks
alter table public.behavior_blocks enable row level security;
drop policy if exists "behavior_blocks own" on public.behavior_blocks;
create policy "behavior_blocks own" on public.behavior_blocks
  for select using (auth.uid() = user_id);
drop policy if exists "behavior_blocks insert own" on public.behavior_blocks;
create policy "behavior_blocks insert own" on public.behavior_blocks
  for insert with check (auth.uid() = user_id);
drop policy if exists "behavior_blocks insert service" on public.behavior_blocks;
create policy "behavior_blocks insert service" on public.behavior_blocks
  for insert with check (true);
alter table public.keystroke_logs add column if not exists line_time_ms float;
alter table public.keystroke_logs add column if not exists idle_ms float;
alter table public.keystroke_logs add column if not exists error_count integer default 0;
alter table public.keystroke_logs add column if not exists paste_detected boolean default false;
alter table public.keystroke_logs add column if not exists pasted_char_count integer default 0;
alter table public.keystroke_logs add column if not exists pasted_line_count integer default 0;
alter table public.keystroke_logs add column if not exists sudden_code_jump boolean default false;

-- KEYSTROKE LOGS: add behavior block metrics to consolidate all keystroke data
alter table public.keystroke_logs add column if not exists keystroke_count integer;
alter table public.keystroke_logs add column if not exists pause_duration_ms float;
alter table public.keystroke_logs add column if not exists typing_speed_avg float;
alter table public.keystroke_logs add column if not exists hesitation_count integer;
alter table public.keystroke_logs add column if not exists error_recovery_time_ms float;
alter table public.keystroke_logs add column if not exists line_rewrites integer;
alter table public.keystroke_logs add column if not exists code_rewrite_count integer;
alter table public.keystroke_logs add column if not exists deletion_bursts integer;
alter table public.keystroke_logs add column if not exists block_duration_ms float;
alter table public.keystroke_logs add column if not exists focus_level float;
alter table public.keystroke_logs add column if not exists is_completing boolean default false;

-- EMOTION LOGS: add gaze_state if missing
alter table public.emotion_logs add column if not exists gaze_state text;

-- REPORTS: ensure all cognitive score columns exist
alter table public.reports add column if not exists problem_breakdown_score float;
alter table public.reports add column if not exists debugging_score float;
alter table public.reports add column if not exists focus_score float;
alter table public.reports add column if not exists planning_score float;
alter table public.reports add column if not exists flexibility_score float;
alter table public.reports add column if not exists heatmap_data jsonb;
alter table public.reports add column if not exists summary text;

-- RECOMMENDATIONS: store AI-generated recommendations
create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  test_id uuid references public.skill_tests(id) on delete set null,
  weak_areas jsonb,
  recommended_topics jsonb,
  suggested_questions jsonb,
  ai_feedback text,
  study_plan jsonb,
  created_at timestamptz default now()
);

-- Prevent duplicate recommendations per user+test
alter table public.recommendations add column if not exists study_plan jsonb;
alter table public.recommendations add column if not exists suggested_questions jsonb;

-- Unique constraint for upsert
create unique index if not exists recommendations_user_test_unique 
  on public.recommendations (user_id, test_id) 
  where test_id is not null;

-- RLS for reports (candidates can see their own, recruiters see all)
alter table public.reports enable row level security;
drop policy if exists "reports select own" on public.reports;
create policy "reports select own" on public.reports
  for select using (auth.uid() = user_id);
drop policy if exists "reports insert own" on public.reports;
create policy "reports insert own" on public.reports
  for insert with check (auth.uid() = user_id);
drop policy if exists "reports update own" on public.reports;
create policy "reports update own" on public.reports
  for update using (auth.uid() = user_id);

-- RLS for recommendations
alter table public.recommendations enable row level security;
drop policy if exists "recs select own" on public.recommendations;
create policy "recs select own" on public.recommendations
  for select using (auth.uid() = user_id);
drop policy if exists "recs insert own" on public.recommendations;
create policy "recs insert own" on public.recommendations
  for insert with check (auth.uid() = user_id);
drop policy if exists "recs update own" on public.recommendations;
create policy "recs update own" on public.recommendations
  for update using (auth.uid() = user_id);

-- Performance indexes
create index if not exists idx_keystroke_user_test on public.keystroke_logs (user_id, test_id);
create index if not exists idx_emotion_user_test on public.emotion_logs (user_id, test_id);
create index if not exists idx_reports_user on public.reports (user_id, created_at desc);
create index if not exists idx_submissions_user_test on public.submissions (user_id, test_id);
create index if not exists idx_recs_user on public.recommendations (user_id, created_at desc);

-- COLLABORATIVE CODING ----------------------------------------------
-- The backend uses the Supabase service role after verifying each user's
-- Supabase access token and room membership. Browser reads are additionally
-- restricted by the row-level policies below; browser writes are not granted.
-- Teacher roles are read from Supabase Auth app_metadata.role; only server-side
-- Auth Admin operations should grant that claim.
create table if not exists public.collaboration_rooms (
  id uuid primary key,
  room_code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  teacher_id uuid references auth.users(id) on delete cascade,
  invite_hash text not null unique,
  language text not null check (language in ('python', 'javascript', 'java', 'cpp', 'c', 'go', 'rust')),
  room_type text not null default 'collaborative' check (room_type in ('collaborative', 'teacher_assignment')),
  constraint collaboration_rooms_teacher_id_check check (room_type <> 'teacher_assignment' or teacher_id is not null),
  content_state text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.collaboration_rooms
  add column if not exists room_type text not null default 'collaborative'
  check (room_type in ('collaborative', 'teacher_assignment'));
alter table public.collaboration_rooms
  add column if not exists teacher_id uuid references auth.users(id) on delete cascade;

create unique index if not exists idx_collaboration_rooms_room_code
  on public.collaboration_rooms (room_code);

create table if not exists public.collaboration_room_members (
  room_id uuid not null references public.collaboration_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.collaboration_room_members
  drop constraint if exists collaboration_room_members_role_check;
alter table public.collaboration_room_members
  add constraint collaboration_room_members_role_check check (role in ('owner', 'member', 'teacher'));

create table if not exists public.collaboration_room_join_requests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.collaboration_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  requester_name text not null,
  status text not null check (status in ('pending', 'accepted', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  unique (room_id, user_id)
);

create table if not exists public.collaboration_room_teacher_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.collaboration_rooms(id) on delete cascade,
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users(id) on delete set null
);

create table if not exists public.collaboration_room_feedback (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.collaboration_rooms(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 2000),
  line_number integer check (line_number is null or line_number > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.collaboration_assignments (
  room_id uuid primary key references public.collaboration_rooms(id) on delete cascade,
  room_name text not null check (char_length(room_name) between 1 and 120),
  title text not null check (char_length(title) between 1 and 120),
  teacher_name text not null check (char_length(teacher_name) between 1 and 120),
  instructions text not null default '' check (char_length(instructions) <= 10000),
  deadline timestamptz,
  created_at timestamptz not null default now()
);

alter table public.collaboration_assignments
  add column if not exists room_name text not null default 'Teacher Assignment'
  check (char_length(room_name) between 1 and 120);

create table if not exists public.collaboration_assignment_workspaces (
  id uuid not null default gen_random_uuid(),
  room_id uuid not null references public.collaboration_assignments(room_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content_state text not null,
  saved_code text not null default '',
  saved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create unique index if not exists idx_assignment_workspaces_id
  on public.collaboration_assignment_workspaces (id);

create table if not exists public.collaboration_assignment_progress (
  room_id uuid not null references public.collaboration_assignments(room_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  code_runs integer not null default 0 check (code_runs >= 0),
  attempts integer not null default 0 check (attempts >= 0),
  errors integer not null default 0 check (errors >= 0),
  submission_status text not null default 'Pending' check (submission_status in ('Pending', 'Submitted')),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.collaboration_assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.collaboration_assignments(room_id) on delete cascade,
  assignment_id uuid not null references public.collaboration_assignments(room_id) on delete cascade,
  workspace_id uuid references public.collaboration_assignment_workspaces(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  status text not null default 'submitted' check (status in ('submitted')),
  attempt integer not null check (attempt > 0),
  submitted_at timestamptz not null default now()
);

create table if not exists public.collaboration_assignment_runs (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.collaboration_assignments(room_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  has_error boolean not null,
  ran_at timestamptz not null default now()
);

create table if not exists public.collaboration_assignment_feedback_requests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.collaboration_assignments(room_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null default '' check (char_length(message) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'fulfilled')),
  requested_at timestamptz not null default now()
);

create table if not exists public.collaboration_assignment_feedback (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.collaboration_assignments(room_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 2000),
  concept text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_collaboration_assignment_teacher_rooms
  on public.collaboration_rooms (teacher_id, created_at desc)
  where room_type = 'teacher_assignment';
create index if not exists idx_collaboration_assignment_submissions_student
  on public.collaboration_assignment_submissions (room_id, user_id, submitted_at desc);
create index if not exists idx_collaboration_assignment_submissions_assignment
  on public.collaboration_assignment_submissions (assignment_id, submitted_at desc);
create index if not exists idx_collaboration_assignment_runs_student
  on public.collaboration_assignment_runs (room_id, user_id, ran_at desc);
create index if not exists idx_collaboration_assignment_feedback_student
  on public.collaboration_assignment_feedback (room_id, user_id, created_at desc);
create index if not exists idx_collaboration_assignment_feedback_requests_student
  on public.collaboration_assignment_feedback_requests (room_id, user_id, status);

create index if not exists idx_collaboration_members_user
  on public.collaboration_room_members (user_id, room_id);

create index if not exists idx_collaboration_join_requests_pending
  on public.collaboration_room_join_requests (room_id, requested_at)
  where status = 'pending';
create index if not exists idx_collaboration_teacher_invites_room
  on public.collaboration_room_teacher_invites (room_id, expires_at)
  where redeemed_at is null;
create index if not exists idx_collaboration_feedback_room
  on public.collaboration_room_feedback (room_id, created_at);

alter table public.collaboration_rooms enable row level security;
alter table public.collaboration_room_members enable row level security;
alter table public.collaboration_room_join_requests enable row level security;
alter table public.collaboration_room_teacher_invites enable row level security;
alter table public.collaboration_room_feedback enable row level security;
alter table public.collaboration_assignments enable row level security;
alter table public.collaboration_assignment_workspaces enable row level security;
alter table public.collaboration_assignment_progress enable row level security;
alter table public.collaboration_assignment_submissions enable row level security;
alter table public.collaboration_assignment_runs enable row level security;
alter table public.collaboration_assignment_feedback_requests enable row level security;
alter table public.collaboration_assignment_feedback enable row level security;

-- Browser reads are scoped by membership, student ownership, and trusted teacher role.
-- All writes still go through the authenticated backend using the service role.
create or replace function public.collaboration_is_assignment_teacher(target_room_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'student') = 'teacher'
    and exists (
      select 1 from public.collaboration_rooms r
      join public.collaboration_room_members m on m.room_id = r.id
      where r.id = target_room_id and r.room_type = 'teacher_assignment'
        and r.teacher_id = auth.uid() and m.user_id = auth.uid() and m.role = 'owner'
    );
$$;

create or replace function public.collaboration_is_assignment_student(target_room_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'student') = 'student'
    and exists (
      select 1 from public.collaboration_rooms r
      join public.collaboration_room_members m on m.room_id = r.id
      where r.id = target_room_id and r.room_type = 'teacher_assignment'
        and m.user_id = auth.uid() and m.role = 'member'
    );
$$;

create or replace function public.collaboration_is_room_member(target_room_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.collaboration_room_members m
    where m.room_id = target_room_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.collaboration_is_collaborative_room_owner(target_room_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.collaboration_rooms r
    join public.collaboration_room_members m on m.room_id = r.id
    where r.id = target_room_id and r.room_type = 'collaborative'
      and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

revoke all on function public.collaboration_is_assignment_teacher(uuid) from public, anon;
revoke all on function public.collaboration_is_assignment_student(uuid) from public, anon;
revoke all on function public.collaboration_is_room_member(uuid) from public, anon;
revoke all on function public.collaboration_is_collaborative_room_owner(uuid) from public, anon;
grant execute on function public.collaboration_is_assignment_teacher(uuid) to authenticated, service_role;
grant execute on function public.collaboration_is_assignment_student(uuid) to authenticated, service_role;
grant execute on function public.collaboration_is_room_member(uuid) to authenticated, service_role;
grant execute on function public.collaboration_is_collaborative_room_owner(uuid) to authenticated, service_role;

drop policy if exists collaboration_rooms_read_member_or_teacher on public.collaboration_rooms;
create policy collaboration_rooms_read_member_or_teacher on public.collaboration_rooms for select to authenticated
  using ((room_type = 'collaborative' and public.collaboration_is_room_member(id))
    or public.collaboration_is_assignment_teacher(id) or public.collaboration_is_assignment_student(id));
drop policy if exists collaboration_members_read_scoped on public.collaboration_room_members;
create policy collaboration_members_read_scoped on public.collaboration_room_members for select to authenticated
  using (user_id = auth.uid() or public.collaboration_is_collaborative_room_owner(room_id)
    or public.collaboration_is_assignment_teacher(room_id));
drop policy if exists collaboration_assignments_read_member_or_teacher on public.collaboration_assignments;
create policy collaboration_assignments_read_member_or_teacher on public.collaboration_assignments for select to authenticated
  using (public.collaboration_is_assignment_teacher(room_id) or public.collaboration_is_assignment_student(room_id));
drop policy if exists assignment_workspaces_read_private on public.collaboration_assignment_workspaces;
create policy assignment_workspaces_read_private on public.collaboration_assignment_workspaces for select to authenticated
  using ((user_id = auth.uid() and public.collaboration_is_assignment_student(room_id))
    or public.collaboration_is_assignment_teacher(room_id));
drop policy if exists assignment_progress_read_private on public.collaboration_assignment_progress;
create policy assignment_progress_read_private on public.collaboration_assignment_progress for select to authenticated
  using ((user_id = auth.uid() and public.collaboration_is_assignment_student(room_id))
    or public.collaboration_is_assignment_teacher(room_id));
drop policy if exists assignment_submissions_read_private on public.collaboration_assignment_submissions;
create policy assignment_submissions_read_private on public.collaboration_assignment_submissions for select to authenticated
  using ((user_id = auth.uid() and public.collaboration_is_assignment_student(room_id))
    or public.collaboration_is_assignment_teacher(room_id));
drop policy if exists assignment_runs_read_private on public.collaboration_assignment_runs;
create policy assignment_runs_read_private on public.collaboration_assignment_runs for select to authenticated
  using ((user_id = auth.uid() and public.collaboration_is_assignment_student(room_id))
    or public.collaboration_is_assignment_teacher(room_id));
drop policy if exists assignment_feedback_requests_read_private on public.collaboration_assignment_feedback_requests;
create policy assignment_feedback_requests_read_private on public.collaboration_assignment_feedback_requests for select to authenticated
  using ((user_id = auth.uid() and public.collaboration_is_assignment_student(room_id))
    or public.collaboration_is_assignment_teacher(room_id));
drop policy if exists assignment_feedback_read_private on public.collaboration_assignment_feedback;
create policy assignment_feedback_read_private on public.collaboration_assignment_feedback for select to authenticated
  using ((user_id = auth.uid() and public.collaboration_is_assignment_student(room_id))
    or public.collaboration_is_assignment_teacher(room_id));
drop policy if exists collaboration_room_feedback_read_member on public.collaboration_room_feedback;
create policy collaboration_room_feedback_read_member on public.collaboration_room_feedback for select to authenticated
  using (public.collaboration_is_room_member(room_id));

revoke all on public.collaboration_rooms, public.collaboration_room_members, public.collaboration_room_join_requests,
  public.collaboration_room_teacher_invites, public.collaboration_room_feedback, public.collaboration_assignments,
  public.collaboration_assignment_workspaces, public.collaboration_assignment_progress,
  public.collaboration_assignment_submissions, public.collaboration_assignment_runs,
  public.collaboration_assignment_feedback_requests, public.collaboration_assignment_feedback from anon, authenticated;
grant select on public.collaboration_rooms, public.collaboration_room_members, public.collaboration_room_feedback,
  public.collaboration_assignments, public.collaboration_assignment_workspaces,
  public.collaboration_assignment_progress, public.collaboration_assignment_submissions,
  public.collaboration_assignment_runs, public.collaboration_assignment_feedback_requests,
  public.collaboration_assignment_feedback to authenticated;
grant select, insert, update, delete on public.collaboration_rooms, public.collaboration_room_members,
  public.collaboration_room_join_requests, public.collaboration_room_teacher_invites,
  public.collaboration_room_feedback, public.collaboration_assignments,
  public.collaboration_assignment_workspaces, public.collaboration_assignment_progress,
  public.collaboration_assignment_submissions, public.collaboration_assignment_runs,
  public.collaboration_assignment_feedback_requests, public.collaboration_assignment_feedback to service_role;
