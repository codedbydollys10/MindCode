# MindCode Frontend

## Environment
Copy `.env.example` to `.env` and set:
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_REDIRECT_TO` (e.g. `http://localhost:5173/dashboard`)
- `VITE_CODE_RUNNER_URL` (e.g. `https://mind-code-gilt.vercel.app`)
- `VITE_COLLABORATION_API_URL` / `VITE_COLLABORATION_WS_URL` (optional; defaults to the code runner backend and its `/collaboration` WebSocket)

## Auth
Google and GitHub OAuth go through Supabase. Auth events upsert to `public.user_profiles`; apply `supabase_schema.sql` in your project SQL editor to create policies.

## Code runner
`Assessment` page calls the backend Judge0 proxy at `VITE_CODE_RUNNER_URL` to execute code for Python/JS/Java/C++.

## Collaborative coding
For an existing Supabase project, apply `migrations/20261001_teacher_assignments.sql` and `migrations/20261001_profile_avatars.sql` in the Supabase SQL editor. They add the teacher assignment schema and private avatar storage without deleting existing data. For a new project, apply `supabase_schema.sql`. Run the existing backend as a persistent Node.js service with its Supabase service-role environment configured; WebSocket collaboration is disabled by the backend when `VERCEL=1`.

Account roles are read from Supabase Auth `app_metadata.role`. Accounts without a server-assigned role remain students. To provision an existing authenticated user as a teacher in development, securely configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `backend/.env`, then run `node scripts/grant-teacher-role.mjs <authenticated-user-id>` from `backend`. Never expose the service-role key; the target user must sign out and back in after provisioning.

Students create `collaborative` rooms or join `teacher_assignment` rooms with the teacher's code/link at `/join/<joinCode>`. Only teacher accounts can create assignments, and assignment monitoring is restricted to the teacher ID stored on that room. Student editor state, submissions, progress, and feedback are isolated by authenticated student ID and accessed through the backend. The browser's direct database reads are also constrained by RLS.

Profile images use the private Supabase Storage bucket `avatars`; `public.users.avatar_path` stores the object path. Authenticated users can manage only objects below their own user-ID folder. Existing `photo_data` values are retained as a legacy display fallback; new uploads are stored in Storage, not in the profile row.

The Profile learning dashboard derives its 365-day activity, heatmap, coding/language charts, and achievements from the signed-in user's reports and submissions (up to 1,000 recent rows per activity source). Student assignment progress is read only for joined teacher-assignment rooms and the current student's own progress rows; teacher room/student summaries continue to use the teacher-authorized monitoring API. Assignment analytics require `migrations/20261001_teacher_assignments.sql`; when it is unavailable, assignment metrics and related achievements are shown as unavailable rather than inferred. Achievements are calculated from recorded activity in the browser and are not separately persisted.

The Reports dashboard loads the latest 50 distinct reports for display and charts, while its saved-report KPI uses a Supabase exact count scoped to the signed-in user. Report filters, pagination, and the existing branded PDF actions work over those loaded reports; rows open the existing full report viewer. Missing focus or language fields are excluded from the corresponding analytics instead of being presented as real zero/default data.

The Reports page's Latest Report card uses the existing `public/report.mp4` static asset for its compact, responsive insights video. It is muted, inline, controllable, and respects reduced-motion preferences; unavailable media displays an in-card fallback.
