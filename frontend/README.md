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
Apply the collaboration table additions in `supabase_schema.sql` in the Supabase SQL editor. Run the existing backend as a persistent Node.js service with its Supabase service-role environment configured; WebSocket collaboration is disabled by the backend when `VERCEL=1`. Authenticated users create rooms and invite other users with the generated room ID and invite code.
