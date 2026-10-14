export function exportFilename(jobs, format, date = new Date()) {
  const stamp = `${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}${date.getFullYear()}`;
  const part = (value, fallback, length) => String(value || fallback).normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^a-zA-Z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, length).replace(/-$/, "") || fallback;
  const job = jobs[0];
  const stem = jobs.length === 1
    ? `${stamp}-${part(job.title, "UntitledRole", 80)}-${part(job.company, "unknown", 60).toLowerCase()}-${part(job.site, "other", 30).toLowerCase()}`
    : `${stamp}-jobs-${jobs.length}`;
  return `${stem}.${format === "markdown" ? "md" : format}`;
}

export function toCsv(jobs) {
  const keys = ["id", "source_url", "site", "captured_at", "title", "company", "location", "description_text", "employment_type", "salary_text"];
  const cell = (value) => {
    const text = Array.isArray(value) ? value.join("\n") : value ?? "";
    return `"${String(text).replaceAll('"', '""')}"`;
  };
  return [keys.map(cell).join(","), ...jobs.map((job) => keys.map((key) => cell(job[key])).join(","))].join("\r\n");
}

export function toMarkdown(jobs) {
  return jobs.map((job) => {
    const out = [`# ${job.title || "Untitled advert"}`, "", `- Company: ${job.company || "Unknown"}`, `- Location: ${job.location || "Unknown"}`, `- Site: ${job.site}`, `- Source: ${job.source_url}`, `- Captured: ${job.captured_at}`, "", "## Description", "", job.description_text || ""];
    return out.join("\n");
  }).join("\n\n---\n\n");
}
