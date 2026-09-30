import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envPath = new URL("../.env", import.meta.url);
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, "utf8");
  raw.split(/\r?\n/).forEach((line) => {
    if (!line || line.trim().startsWith("#")) return;
    const idx = line.indexOf("=");
    if (idx <= 0) return;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  });
}

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("Missing env: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function verify() {
  const checks = [
    { table: "users", select: "id,email,name,created_at", orderBy: "created_at" },
    { table: "skill_tests", select: "id,user_id,topic,difficulty,created_at", orderBy: "created_at" },
    { table: "reports", select: "id,user_id,focus_score,debugging_score,created_at", orderBy: "created_at" },
    { table: "keystroke_logs", select: "id,user_id,test_id,pause_duration,timestamp", orderBy: "timestamp" },
    { table: "emotion_logs", select: "id,user_id,test_id,emotion,timestamp", orderBy: "timestamp" },
    { table: "recommendations", select: "id,user_id,test_id,weak_areas,created_at", orderBy: "created_at" },
  ];

  for (const check of checks) {
    const { data, error, count } = await supabase
      .from(check.table)
      .select(check.select, { count: "exact" })
      .order(check.orderBy, { ascending: false })
      .limit(3);

    if (error) {
      console.error(`❌ ${check.table} query failed: ${error.message}`);
      continue;
    }

    console.log(`\n✅ ${check.table}: count=${count}`);
    (data || []).forEach((row) => {
      console.log(`- ${JSON.stringify(row)}`);
    });
  }
}

verify().then(() => process.exit()).catch((err) => {
  console.error(err);
  process.exit(1);
});
