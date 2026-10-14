export const SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS = Object.freeze({
  llmEnabled: false,
  extraction: {
    provider: "vps",
    model: "gpt-4.1-mini",
    baseUrl: "https://localgemma.wanagents.duckdns.org",
    token: "",
    extractPath: "/extract-job",
    statusPath: "/llm/status",
    wakePath: "/llm/wake",
    timeoutSeconds: 180,
    supportsStatus: true,
    supportsWake: true,
    promptMode: "server",
    systemPrompt: "",
    extraInstructions: "",
    maxInputChars: 30000
  },
  inbox: { baseUrl: "", token: "", path: "/jobs", enabled: false },
  export: {
    format: "json",
    filenamePattern: "jobs-{date}",
    includeRefinedArrays: true,
    saveAs: true
  },
  inactivityMinutes: 10
});

export function createJob(captured) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    source_url: captured.source_url || "",
    site: captured.site || "other",
    captured_at: now,
    title: captured.title || null,
    company: captured.company || null,
    location: captured.location || null,
    description_text: String(captured.description_text || "").trim(),
    employment_type: captured.employment_type || null,
    salary_text: captured.salary_text || null,
    extraction_mode: "raw",
    requirements: [],
    responsibilities: [],
    skills: [],
    notes: null,
    warnings: Array.isArray(captured.warnings) ? [...captured.warnings] : []
  };
}

export function normalizeState(input) {
  if (!input || typeof input !== "object") {
    return { schemaVersion: SCHEMA_VERSION, jobs: [], settings: structuredClone(DEFAULT_SETTINGS) };
  }

  const oldJobs = Array.isArray(input.jobs) ? input.jobs : [];
  const jobs = oldJobs.map((item) => {
    const raw = item.description_text ?? item.cleaned_text ?? item.description ?? "";
    return {
      id: item.id || crypto.randomUUID(),
      source_url: item.source_url || item.url || "",
      site: item.site || "other",
      captured_at: item.captured_at || new Date().toISOString(),
      title: item.title || null,
      company: item.company || null,
      location: item.location || null,
      description_text: String(raw),
      employment_type: item.employment_type || null,
      salary_text: item.salary_text || null,
      extraction_mode: item.extraction_mode === "llm_refined" ? "llm_refined" : "raw",
      requirements: Array.isArray(item.requirements) ? item.requirements : [],
      responsibilities: Array.isArray(item.responsibilities) ? item.responsibilities : [],
      skills: Array.isArray(item.skills) ? item.skills : [],
      notes: item.notes || null,
      warnings: Array.isArray(item.warnings) ? item.warnings : [],
      ...(item.operationState ? { operationState: item.operationState } : {})
    };
  });
  const oldSettings = input.settings && typeof input.settings === "object" ? input.settings : {};
  return {
    schemaVersion: SCHEMA_VERSION,
    jobs,
    settings: {
      ...structuredClone(DEFAULT_SETTINGS),
      ...oldSettings,
      extraction: { ...DEFAULT_SETTINGS.extraction, ...(oldSettings.extraction || {}) },
      inbox: { ...DEFAULT_SETTINGS.inbox, ...(oldSettings.inbox || {}) },
      export: { ...DEFAULT_SETTINGS.export, ...(oldSettings.export || {}) }
    }
  };
}

export function exportJob(job, includeRefinedArrays = true) {
  const result = {
    id: job.id,
    source_url: job.source_url,
    site: job.site,
    captured_at: job.captured_at,
    title: job.title,
    company: job.company,
    location: job.location,
    description_text: job.description_text,
    employment_type: job.employment_type,
    salary_text: job.salary_text,
    extraction_mode: job.extraction_mode,
    requirements: includeRefinedArrays ? job.requirements : [],
    responsibilities: includeRefinedArrays ? job.responsibilities : [],
    skills: includeRefinedArrays ? job.skills : [],
    notes: includeRefinedArrays ? job.notes : null,
    warnings: job.warnings
  };
  return result;
}
