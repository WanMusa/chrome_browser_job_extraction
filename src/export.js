export function toCsv(jobs, includeRefined = true) {
  const keys = ["id", "source_url", "site", "captured_at", "title", "company", "location", "description_text", "employment_type", "salary_text", "extraction_mode"];
  if (includeRefined) keys.push("requirements", "responsibilities", "skills", "notes", "warnings");
  const cell = (value) => {
    const text = Array.isArray(value) ? value.join("\n") : value ?? "";
    return `"${String(text).replaceAll('"', '""')}"`;
  };
  return [keys.map(cell).join(","), ...jobs.map((job) => keys.map((key) => cell(job[key])).join(","))].join("\r\n");
}

export function toMarkdown(jobs, includeRefined = true) {
  return jobs.map((job) => {
    const out = [`# ${job.title || "Untitled advert"}`, "", `- Company: ${job.company || "Unknown"}`, `- Location: ${job.location || "Unknown"}`, `- Site: ${job.site}`, `- Source: ${job.source_url}`, `- Captured: ${job.captured_at}`, "", "## Description", "", job.description_text || ""];
    if (includeRefined) {
      for (const [heading, key] of [["Requirements", "requirements"], ["Responsibilities", "responsibilities"], ["Skills", "skills"]]) {
        if (job[key]?.length) out.push("", `## ${heading}`, "", ...job[key].map((item) => `- ${item}`));
      }
      if (job.notes) out.push("", "## Notes", "", job.notes);
    }
    return out.join("\n");
  }).join("\n\n---\n\n");
}
