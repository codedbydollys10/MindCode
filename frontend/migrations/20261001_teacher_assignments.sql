-- Incremental migration for existing MindCode Supabase databases.
-- Safe to rerun; existing users, rooms, and assessment data are retained.

alter table public.collaboration_rooms
  add column if not exists room_type text not null default 'collaborative';
alter table public.collaboration_rooms
  add column if not exists teacher_id uuid references auth.users(id) on delete cascade;

alter table public.collaboration_rooms
  drop constraint if exists collaboration_rooms_room_type_check;
alter table public.collaboration_rooms
  add constraint collaboration_rooms_room_type_check
  check (room_type in ('collaborative', 'teacher_assignment'))
  not valid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.collaboration_rooms'::regclass
      and conname = 'collaboration_rooms_teacher_id_check'
  ) then
    alter table public.collaboration_rooms
      add constraint collaboration_rooms_teacher_id_check
      check (room_type <> 'teacher_assignment' or teacher_id is not null)
      not valid;
  end if;
end $$;

update public.collaboration_rooms r
set teacher_id = r.created_by
from auth.users u
where r.room_type = 'teacher_assignment'
  and r.teacher_id is null
  and u.id = r.created_by
  and u.raw_app_meta_data ->> 'role' = 'teacher';

alter table public.collaboration_room_members
  drop constraint if exists collaboration_room_members_role_check;
alter table public.collaboration_room_members
  add constraint collaboration_room_members_role_check
  check (role in ('owner', 'member', 'teacher'))
  not valid;

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
  add column if not exists room_name text not null default 'Teacher Assignment';

create table if not exists public.collaboration_assignment_workspaces (
  id uuid not null default gen_random_uuid() unique,
  room_id uuid not null references public.collaboration_assignments(room_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content_state text not null,
  saved_code text not null default '',
  saved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table public.collaboration_assignment_workspaces
  add column if not exists id uuid not null default gen_random_uuid();
create unique index if not exists idx_assignment_workspaces_id
  on public.collaboration_assignment_workspaces(id);

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

alter table public.collaboration_assignment_submissions
  add column if not exists assignment_id uuid references public.collaboration_assignments(room_id) on delete cascade;
alter table public.collaboration_assignment_submissions
  add column if not exists workspace_id uuid references public.collaboration_assignment_workspaces(id) on delete set null;
alter table public.collaboration_assignment_submissions
  add column if not exists status text not null default 'submitted';
update public.collaboration_assignment_submissions
  set assignment_id = room_id
  where assignment_id is null;
alter table public.collaboration_assignment_submissions
  alter column assignment_id set not null;

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
alter table public.collaboration_assignment_feedback_requests
  add column if not exists message text not null default '';

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

create or replace function public.collaboration_is_assignment_teacher(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'student') = 'teacher'
    and exists (
      select 1 from public.collaboration_rooms r
      join public.collaboration_room_members m on m.room_id = r.id
      where r.id = target_room_id
        and r.room_type = 'teacher_assignment'
        and r.teacher_id = auth.uid()
        and m.user_id = auth.uid()
        and m.role = 'owner'
    );
$$;

create or replace function public.collaboration_is_assignment_student(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'student') = 'student'
    and exists (
      select 1 from public.collaboration_rooms r
      join public.collaboration_room_members m on m.room_id = r.id
      where r.id = target_room_id
        and r.room_type = 'teacher_assignment'
        and m.user_id = auth.uid()
        and m.role = 'member'
    );
$$;

create or replace function public.collaboration_is_room_member(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.collaboration_room_members m
    where m.room_id = target_room_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.collaboration_is_collaborative_room_owner(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.collaboration_rooms r
    join public.collaboration_room_members m on m.room_id = r.id
    where r.id = target_room_id
      and r.room_type = 'collaborative'
      and m.user_id = auth.uid()
      and m.role = 'owner'
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

drop policy if exists collaboration_rooms_read_member_or_teacher on public.collaboration_rooms;
create policy collaboration_rooms_read_member_or_teacher on public.collaboration_rooms for select to authenticated
  using (
    (room_type = 'collaborative' and public.collaboration_is_room_member(id))
    or public.collaboration_is_assignment_teacher(id)
    or public.collaboration_is_assignment_student(id)
  );

drop policy if exists collaboration_members_read_scoped on public.collaboration_room_members;
create policy collaboration_members_read_scoped on public.collaboration_room_members for select to authenticated
  using (
    user_id = auth.uid()
    or public.collaboration_is_collaborative_room_owner(room_id)
    or public.collaboration_is_assignment_teacher(room_id)
  );

drop policy if exists collaboration_assignments_read_member_or_teacher on public.collaboration_assignments;
create policy collaboration_assignments_read_member_or_teacher on public.collaboration_assignments for select to authenticated
  using (public.collaboration_is_assignment_teacher(room_id) or public.collaboration_is_assignment_student(room_id));

drop policy if exists assignment_workspaces_read_private on public.collaboration_assignment_workspaces;
create policy assignment_workspaces_read_private on public.collaboration_assignment_workspaces for select to authenticated
  using (
    (user_id = auth.uid() and public.collaboration_is_assignment_student(room_id))
    or public.collaboration_is_assignment_teacher(room_id)
  );

drop policy if exists assignment_progress_read_private on public.collaboration_assignment_progress;
create policy assignment_progress_read_private on public.collaboration_assignment_progress for select to authenticated
  using (
    (user_id = auth.uid() and public.collaboration_is_assignment_student(room_id))
    or public.collaboration_is_assignment_teacher(room_id)
  );

drop policy if exists assignment_submissions_read_private on public.collaboration_assignment_submissions;
create policy assignment_submissions_read_private on public.collaboration_assignment_submissions for select to authenticated
  using (
    (user_id = auth.uid() and public.collaboration_is_assignment_student(room_id))
    or public.collaboration_is_assignment_teacher(room_id)
  );

drop policy if exists assignment_runs_read_private on public.collaboration_assignment_runs;
create policy assignment_runs_read_private on public.collaboration_assignment_runs for select to authenticated
  using (
    (user_id = auth.uid() and public.collaboration_is_assignment_student(room_id))
    or public.collaboration_is_assignment_teacher(room_id)
  );

drop policy if exists assignment_feedback_requests_read_private on public.collaboration_assignment_feedback_requests;
create policy assignment_feedback_requests_read_private on public.collaboration_assignment_feedback_requests for select to authenticated
  using (
    (user_id = auth.uid() and public.collaboration_is_assignment_student(room_id))
    or public.collaboration_is_assignment_teacher(room_id)
  );

drop policy if exists assignment_feedback_read_private on public.collaboration_assignment_feedback;
create policy assignment_feedback_read_private on public.collaboration_assignment_feedback for select to authenticated
  using (
    (user_id = auth.uid() and public.collaboration_is_assignment_student(room_id))
    or public.collaboration_is_assignment_teacher(room_id)
  );

drop policy if exists collaboration_room_feedback_read_member on public.collaboration_room_feedback;
create policy collaboration_room_feedback_read_member on public.collaboration_room_feedback for select to authenticated
  using (public.collaboration_is_room_member(room_id));

revoke all on public.collaboration_rooms, public.collaboration_room_members,
  public.collaboration_room_join_requests, public.collaboration_room_teacher_invites,
  public.collaboration_room_feedback, public.collaboration_assignments,
  public.collaboration_assignment_workspaces, public.collaboration_assignment_progress,
  public.collaboration_assignment_submissions, public.collaboration_assignment_runs,
  public.collaboration_assignment_feedback_requests, public.collaboration_assignment_feedback
  from anon, authenticated;
grant select on public.collaboration_rooms, public.collaboration_room_members,
  public.collaboration_room_feedback, public.collaboration_assignments,
  public.collaboration_assignment_workspaces, public.collaboration_assignment_progress,
  public.collaboration_assignment_submissions, public.collaboration_assignment_runs,
  public.collaboration_assignment_feedback_requests, public.collaboration_assignment_feedback
  to authenticated;
grant select, insert, update, delete on public.collaboration_rooms,
  public.collaboration_room_members, public.collaboration_room_join_requests,
  public.collaboration_room_teacher_invites, public.collaboration_room_feedback,
  public.collaboration_assignments, public.collaboration_assignment_workspaces,
  public.collaboration_assignment_progress, public.collaboration_assignment_submissions,
  public.collaboration_assignment_runs, public.collaboration_assignment_feedback_requests,
  public.collaboration_assignment_feedback to service_role;
