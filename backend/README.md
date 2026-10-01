# SkillDNA Editor Backend

Simple Express proxy to Judge0 CE used by the frontend code runner.

## Setup
1) Copy `.env.example` to `.env` and set `JUDGE0_URL` and optional `JUDGE0_TOKEN`.
2) Install dependencies: `npm install` (or `pnpm install` / `yarn install`).
3) Run locally: `npm run dev` (defaults to `http://localhost:3001`).

The frontend reads `VITE_CODE_RUNNER_URL` and points to this server.

### Collaborative coding
For an existing Supabase project, apply `frontend/migrations/20261001_teacher_assignments.sql` in the Supabase SQL editor. It adds the missing teacher ownership and assignment-workflow schema, preserves existing data, and installs row-level read policies. For a new project, apply `frontend/supabase_schema.sql`. Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for this backend. The collaboration WebSocket runs at `/collaboration` and requires a persistent Node.js process; it is not available when `VERCEL=1`. The existing telemetry socket remains at `/stream`.

Teacher authorization uses the server-managed Supabase Auth claim `app_metadata.role`. New and existing users without that claim are students. For development, provision a teacher by authenticating that user normally, then run `node scripts/grant-teacher-role.mjs <authenticated-user-id>` from `backend` with the service-role key set in `backend/.env`. The script only changes the selected user's app metadata; never put the service-role key in the frontend. The teacher must sign out and sign back in to refresh their token.

Assignment creation and monitoring endpoints require both the teacher role and the assignment's matching `teacher_id`. Assignment Yjs documents and all personal progress/submission/feedback endpoints are scoped by authenticated student ID; assignment documents are not broadcast between students. Authenticated browser reads are additionally restricted by Supabase RLS; collaboration writes are only granted to the backend service role.

Verify only the required schema metadata (no user rows are read or printed) with `node scripts/verify-collaboration-schema.mjs` from `backend` after applying the migration.

### Supabase health check
If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, hit `GET /health/supabase` to verify connectivity and see the `user_profiles` row count.
