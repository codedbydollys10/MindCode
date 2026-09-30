/**
 * Keystroke Logs Database Query Builder
 * Backend service for inserting keystroke metrics into PostgreSQL
 * Maps all 36 columns exactly
 */

export interface KeystrokeLogRow {
  // Identifiers (auto-generated/managed)
  id?: string; // UUID auto-generated
  user_id: string;
  test_id: string;
  timestamp?: string; // ISO timestamp auto-set on DB

  // Key Input
  key_pressed: string;
  keystroke_count: number;

  // Deletion Tracking
  backspace_count: number;
  deletion_bursts: number;

  // Position & Navigation
  cursor_position: number;
  line_number: number;
  prev_line_number: number | null;

  // Code Content
  code_snapshot: string;
  code_length: number;
  word_count: number;

  // Timing Metrics
  typing_speed: number;
  pause_duration: number;
  pause_duration_ms: number;
  line_time_ms: number;
  idle_time_ms: number;
  idle_ms: number;
  block_duration_ms: number;

  // Aggregate Speed
  typing_speed_avg: number;

  // Action Type
  action_type: string;

  // Paste Detection
  paste_detected: boolean;
  is_paste_event: boolean;
  paste_char_count: number;
  pasted_char_count: number;
  paste_line_count: number;
  pasted_line_count: number;

  // Anomaly Detection
  burst_insert_detected: boolean;
  sudden_code_jump: boolean;

  // Error Tracking
  error_count: number;
  error_recovery_time_ms: number | null;

  // Code Quality
  line_rewrites: number;
  code_rewrite_count: number;
  hesitation_count: number;

  // Behavioral
  focus_level: number;
  is_completing: boolean;
}

/**
 * Validates and sanitizes keystroke log data
 */
export function validateKeystrokeLog(data: Partial<KeystrokeLogRow>): KeystrokeLogRow {
  if (!data.user_id || !data.test_id) {
    throw new Error("user_id and test_id are required");
  }

  // Helper: coerce to number or null
  const asNum = (val: any, fallback: number = 0): number => {
    const n = Number(val);
    return isNaN(n) ? fallback : n;
  };

  // Helper: coerce to boolean
  const asBool = (val: any, fallback: boolean = false): boolean => {
    if (typeof val === "boolean") return val;
    if (typeof val === "string") return val.toLowerCase() === "true";
    return fallback;
  };

  // Helper: clamp number between min and max
  const clamp = (val: number, min: number, max: number): number => {
    return Math.max(min, Math.min(max, val));
  };

  // Helper: truncate string to max length
  const truncate = (val: any, maxLen: number): string => {
    return String(val || "").substring(0, maxLen);
  };

  return {
    user_id: String(data.user_id),
    test_id: String(data.test_id),
    timestamp: data.timestamp || new Date().toISOString(),
    key_pressed: truncate(data.key_pressed || "", 256),
    keystroke_count: asNum(data.keystroke_count, 0),
    backspace_count: Math.max(0, asNum(data.backspace_count, 0)),
    deletion_bursts: Math.max(0, asNum(data.deletion_bursts, 0)),
    cursor_position: Math.max(0, asNum(data.cursor_position, 0)),
    line_number: Math.max(0, asNum(data.line_number, 0)),
    prev_line_number: data.prev_line_number !== null && data.prev_line_number !== undefined ? asNum(data.prev_line_number, 0) : null,
    code_snapshot: truncate(data.code_snapshot || "", 10000), // Max 10k chars
    code_length: Math.max(0, asNum(data.code_length, 0)),
    word_count: Math.max(0, asNum(data.word_count, 0)),
    typing_speed: Math.max(0, asNum(data.typing_speed, 0)),
    pause_duration: Math.max(0, asNum(data.pause_duration, 0)),
    pause_duration_ms: Math.max(0, asNum(data.pause_duration_ms, 0)),
    line_time_ms: Math.max(0, asNum(data.line_time_ms, 0)),
    idle_time_ms: Math.max(0, asNum(data.idle_time_ms, 0)),
    idle_ms: Math.max(0, asNum(data.idle_ms, 0)),
    block_duration_ms: Math.max(0, asNum(data.block_duration_ms, 0)),
    typing_speed_avg: Math.max(0, asNum(data.typing_speed_avg, 0)),
    action_type: truncate(data.action_type || "insert", 64),
    paste_detected: asBool(data.paste_detected, false),
    is_paste_event: asBool(data.is_paste_event, false),
    paste_char_count: Math.max(0, asNum(data.paste_char_count, 0)),
    pasted_char_count: Math.max(0, asNum(data.pasted_char_count, 0)),
    paste_line_count: Math.max(0, asNum(data.paste_line_count, 0)),
    pasted_line_count: Math.max(0, asNum(data.pasted_line_count, 0)),
    burst_insert_detected: asBool(data.burst_insert_detected, false),
    sudden_code_jump: asBool(data.sudden_code_jump, false),
    error_count: Math.max(0, asNum(data.error_count, 0)),
    error_recovery_time_ms: data.error_recovery_time_ms !== null && data.error_recovery_time_ms !== undefined ? asNum(data.error_recovery_time_ms, 0) : null,
    line_rewrites: Math.max(0, asNum(data.line_rewrites, 0)),
    code_rewrite_count: Math.max(0, asNum(data.code_rewrite_count, 0)),
    hesitation_count: Math.max(0, asNum(data.hesitation_count, 0)),
    focus_level: clamp(asNum(data.focus_level, 50), 0, 100),
    is_completing: asBool(data.is_completing, false),
  };
}

/**
 * Builds INSERT SQL statement for keystroke_logs table
 * Maps all 36 columns exactly as specified
 */
export function buildKeystrokeInsertSQL(row: KeystrokeLogRow): { sql: string; params: any[] } {
  const columns = [
    "user_id",
    "test_id",
    "timestamp",
    "key_pressed",
    "keystroke_count",
    "backspace_count",
    "deletion_bursts",
    "cursor_position",
    "line_number",
    "prev_line_number",
    "code_snapshot",
    "code_length",
    "word_count",
    "typing_speed",
    "pause_duration",
    "pause_duration_ms",
    "line_time_ms",
    "idle_time_ms",
    "idle_ms",
    "block_duration_ms",
    "typing_speed_avg",
    "action_type",
    "paste_detected",
    "is_paste_event",
    "paste_char_count",
    "pasted_char_count",
    "paste_line_count",
    "pasted_line_count",
    "burst_insert_detected",
    "sudden_code_jump",
    "error_count",
    "error_recovery_time_ms",
    "line_rewrites",
    "code_rewrite_count",
    "hesitation_count",
    "focus_level",
    "is_completing",
  ];

  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const columnNames = columns.join(", ");

  const values = [
    row.user_id,
    row.test_id,
    row.timestamp,
    row.key_pressed,
    row.keystroke_count,
    row.backspace_count,
    row.deletion_bursts,
    row.cursor_position,
    row.line_number,
    row.prev_line_number,
    row.code_snapshot,
    row.code_length,
    row.word_count,
    row.typing_speed,
    row.pause_duration,
    row.pause_duration_ms,
    row.line_time_ms,
    row.idle_time_ms,
    row.idle_ms,
    row.block_duration_ms,
    row.typing_speed_avg,
    row.action_type,
    row.paste_detected,
    row.is_paste_event,
    row.paste_char_count,
    row.pasted_char_count,
    row.paste_line_count,
    row.pasted_line_count,
    row.burst_insert_detected,
    row.sudden_code_jump,
    row.error_count,
    row.error_recovery_time_ms,
    row.line_rewrites,
    row.code_rewrite_count,
    row.hesitation_count,
    row.focus_level,
    row.is_completing,
  ];

  const sql = `INSERT INTO keystroke_logs (${columnNames}) VALUES (${placeholders}) RETURNING id;`;

  return { sql, params: values };
}

/**
 * Batch insert keystroke logs using Supabase client
 */
export async function insertKeystrokeLogs(
  supabase: any,
  logs: KeystrokeLogRow[]
): Promise<{ success: number; failed: number; errors: Array<{ index: number; error: string }> }> {
  const errors: Array<{ index: number; error: string }> = [];
  let successCount = 0;
  let failedCount = 0;

  // Validate and sanitize all logs
  const validatedLogs = logs
    .map((log, index) => {
      try {
        return validateKeystrokeLog(log);
      } catch (err) {
        errors.push({
          index,
          error: err instanceof Error ? err.message : String(err),
        });
        failedCount++;
        return null;
      }
    })
    .filter((log) => log !== null) as KeystrokeLogRow[];

  if (validatedLogs.length === 0) {
    console.error(`[KeystrokeDB] All ${logs.length} records failed validation`);
    return { success: 0, failed: failedCount, errors };
  }

  try {
    // Insert using Supabase client
    const { data, error } = await supabase.from("keystroke_logs").insert(validatedLogs).select();

    if (error) {
      console.error("[KeystrokeDB] Insert error:", error);
      // If specific columns don't exist, try with minimal schema
      const minimalLogs = validatedLogs.map((log) => ({
        user_id: log.user_id,
        test_id: log.test_id,
        timestamp: log.timestamp,
        key_pressed: log.key_pressed,
        keystroke_count: log.keystroke_count,
        backspace_count: log.backspace_count,
        deletion_bursts: log.deletion_bursts,
        cursor_position: log.cursor_position,
        line_number: log.line_number,
        prev_line_number: log.prev_line_number,
        code_snapshot: log.code_snapshot,
        code_length: log.code_length,
        word_count: log.word_count,
        typing_speed: log.typing_speed,
        pause_duration: log.pause_duration,
        pause_duration_ms: log.pause_duration_ms,
        line_time_ms: log.line_time_ms,
        idle_time_ms: log.idle_time_ms,
        idle_ms: log.idle_ms,
        block_duration_ms: log.block_duration_ms,
        typing_speed_avg: log.typing_speed_avg,
        action_type: log.action_type,
        paste_detected: log.paste_detected,
        is_paste_event: log.is_paste_event,
        paste_char_count: log.paste_char_count,
        pasted_char_count: log.pasted_char_count,
        paste_line_count: log.paste_line_count,
        pasted_line_count: log.pasted_line_count,
        burst_insert_detected: log.burst_insert_detected,
        sudden_code_jump: log.sudden_code_jump,
        error_count: log.error_count,
        error_recovery_time_ms: log.error_recovery_time_ms,
        line_rewrites: log.line_rewrites,
        code_rewrite_count: log.code_rewrite_count,
        hesitation_count: log.hesitation_count,
        focus_level: log.focus_level,
        is_completing: log.is_completing,
      }));

      const { data: data2, error: error2 } = await supabase.from("keystroke_logs").insert(minimalLogs).select();

      if (error2) {
        console.error("[KeystrokeDB] Retry insert failed:", error2);
        failedCount += validatedLogs.length;
        errors.push({
          index: -1,
          error: `Batch insert failed: ${error2.message}`,
        });
      } else {
        successCount = data2?.length || validatedLogs.length;
      }
    } else {
      successCount = data?.length || validatedLogs.length;
      console.log(`[KeystrokeDB] ✅ Successfully inserted ${successCount} records`);
    }
  } catch (err) {
    console.error("[KeystrokeDB] Unexpected error:", err);
    failedCount += validatedLogs.length;
    errors.push({
      index: -1,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { success: successCount, failed: failedCount, errors };
}

/**
 * Get keystroke statistics for a user/test
 */
export async function getKeystrokeStats(supabase: any, userId: string, testId: string) {
  const { data, error } = await supabase
    .from("keystroke_logs")
    .select(
      `
      keystroke_count,
      typing_speed_avg,
      pause_duration_ms,
      focus_level,
      error_count,
      hesitation_count,
      paste_detected
    `
    )
    .eq("user_id", userId)
    .eq("test_id", testId)
    .order("timestamp", { ascending: true });

  if (error) {
    console.error("[KeystrokeDB] Failed to fetch stats:", error);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  // Compute aggregates
  const stats = {
    totalKeystrokes: data.reduce((sum: number, row: any) => sum + (row.keystroke_count || 0), 0),
    avgTypingSpeed: data.reduce((sum: number, row: any) => sum + (row.typing_speed_avg || 0), 0) / data.length,
    avgPauseDuration: data.reduce((sum: number, row: any) => sum + (row.pause_duration_ms || 0), 0) / data.length,
    avgFocusLevel: data.reduce((sum: number, row: any) => sum + (row.focus_level || 0), 0) / data.length,
    totalErrors: data.reduce((sum: number, row: any) => sum + (row.error_count || 0), 0),
    totalHesitations: data.reduce((sum: number, row: any) => sum + (row.hesitation_count || 0), 0),
    pasteEventCount: data.filter((row: any) => row.paste_detected).length,
    recordCount: data.length,
  };

  return stats;
}
