type SupportedLanguage = "python" | "javascript" | "java" | "cpp" | "c" | "go" | "rust";

const LANGUAGE_IDS: Record<SupportedLanguage, number> = {
  python: 71, // Python (3.8.1) in Judge0 CE
  javascript: 63, // JavaScript (Node.js 18.x)
  java: 62, // Java (OpenJDK 17)
  cpp: 54, // C++ (GCC 9.2.0)
  c: 50, // C (GCC 9.2.0)
  go: 60, // Go (1.13.5)
  rust: 73, // Rust (1.56)
};

const API_BASE = import.meta.env.VITE_CODE_RUNNER_URL || "https://mindcode-4v9p.onrender.com";

export const runCode = async (params: {
  language: SupportedLanguage;
  code: string;
  stdin?: string;
}) => {
  const language_id = LANGUAGE_IDS[params.language];
  const payload = JSON.stringify({
    code: params.code,
    language_id,
    stdin: params.stdin ?? "",
  });
  const endpoints = [`${API_BASE}/run`, `${API_BASE}/execute`];
  let response: Response | null = null;
  let lastUrl = endpoints[0];

  for (const url of endpoints) {
    lastUrl = url;
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    // If this route exists, use its response as source of truth.
    if (response.status !== 404 && response.status !== 405) break;
  }

  if (!response) throw new Error("Code runner request could not be created.");

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed to run code via ${lastUrl} (HTTP ${response.status})`);
  }

  return response.json() as Promise<{
    output: string;
    error: string;
    status: string;
    statusId?: number;
    time?: number;
    memory?: number;
  }>;
};
