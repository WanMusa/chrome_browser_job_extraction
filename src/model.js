export const SCHEMA_VERSION = 2;

export const DEFAULT_SETTINGS = Object.freeze({
  inbox: { baseUrl: "", token: "", path: "/jobs", enabled: false },
  jobRuns: { baseUrl: "", token: "" },
  export: {
    format: "json",
    saveAs: true
  }
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
    salary_text: captured.salary_text || null
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
      salary_text: item.salary_text || null
    };
  });
  const oldSettings = input.settings && typeof input.settings === "object" ? input.settings : {};
  return {
    schemaVersion: SCHEMA_VERSION,
    jobs,
    settings: {
      inbox: { ...DEFAULT_SETTINGS.inbox, ...(oldSettings.inbox || {}) },
      jobRuns: { ...DEFAULT_SETTINGS.jobRuns, ...(oldSettings.jobRuns || {}) },
      export: {
        format: ["json", "csv", "markdown"].includes(oldSettings.export?.format) ? oldSettings.export.format : DEFAULT_SETTINGS.export.format,
        saveAs: oldSettings.export?.saveAs ?? DEFAULT_SETTINGS.export.saveAs
      }
    }
  };
}

export function exportJob(job) {
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
    salary_text: job.salary_text
  };
  return result;
}
