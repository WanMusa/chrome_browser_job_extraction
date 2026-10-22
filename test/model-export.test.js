import test from "node:test";
import assert from "node:assert/strict";
import { createJob, exportJob, normalizeState, SCHEMA_VERSION } from "../src/model.js";
import { exportFilename, toCsv, toMarkdown } from "../src/export.js";
import { parseRefinement, refinementFailure } from "../src/refinement.js";
import { extractionEndpoint, OPENAI_EXTRACT_URL, requestRefinement } from "../src/extraction-api.js";

const source = {
  source_url: "https://example.com/job/1",
  site: "other",
  title: "Engineer",
  description_text: "Requirements:\n5+ years experience\nExperience with C#, SQL"
};

test("captures and exports contain only advert metadata and source text", () => {
  const raw = createJob(source);
  const refined = { ...raw, extraction_mode: "llm_refined", requirements: ["5+ years experience"] };
  const rawPayload = exportJob(raw);
  const refinedPayload = exportJob(refined);
  assert.deepEqual(Object.keys(rawPayload), Object.keys(refinedPayload));
  assert.equal(rawPayload.description_text, source.description_text);
  assert.equal(refinedPayload.description_text, source.description_text);
  assert.deepEqual(Object.keys(rawPayload), ["id", "source_url", "site", "captured_at", "title", "company", "location", "description_text", "employment_type", "salary_text"]);
  assert.deepEqual(Object.keys(raw), Object.keys(rawPayload));
});

test("legacy jobs migrate without changing source text or retaining removed fields", () => {
  const raw = createJob(source);
  const migrated = normalizeState({ schemaVersion: 1, jobs: [{ ...raw, extraction_mode: "raw", requirements: ["legacy"], responsibilities: [], skills: [], notes: "old", warnings: ["old"], operationState: "refining" }], settings: { llmEnabled: true, extraction: { token: "legacy-key" }, export: { format: "csv", saveAs: false, includeRefinedArrays: true } } });
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(migrated.jobs[0], raw);
  assert.deepEqual(migrated.settings.export, { format: "csv", saveAs: false });
  assert.deepEqual(migrated.settings.jobRuns, { baseUrl: "", token: "" });
  assert.equal("extraction" in migrated.settings, false);
});

test("Job Runs settings migrate independently from the inbox token", () => {
  const migrated = normalizeState({ settings: {
    inbox: { baseUrl: "https://inbox.example", token: "inbox-token" },
    jobRuns: { baseUrl: "https://runs.example", token: "runs-token" }
  } });
  assert.deepEqual(migrated.settings.inbox, {
    baseUrl: "https://inbox.example", token: "inbox-token", path: "/resume/batches", enabled: false
  });
  assert.deepEqual(migrated.settings.jobRuns, { baseUrl: "https://runs.example", token: "runs-token" });
});

test("export filenames use local MMDDYYYY, role, company and source with safe fallbacks", () => {
  const job = { title: "Business Analyst", company: "Genesis", site: "linkedin" };
  const date = new Date(2026, 9, 15);
  assert.equal(exportFilename([job], "json", date), "10152026-BusinessAnalyst-genesis-linkedin.json");
  assert.equal(exportFilename([job, job], "csv", date), "10152026-jobs-2.csv");
  assert.equal(exportFilename([{}], "markdown", date), "10152026-UntitledRole-unknown-other.md");
  assert.doesNotMatch(exportFilename([{ title: 'Role: /?*<>|', company: 'Company\\name', site: "other" }], "json", date), /[<>:"/\\|?*]/);
});

test("CSV escapes quotes and preserves multiline cells", () => {
  const csv = toCsv([{ ...createJob(source), title: 'Engineer "II"', description_text: "line one\nline two" }]);
  assert.match(csv, /"Engineer ""II"""/);
  assert.match(csv, /"line one\nline two"/);
});

test("Markdown renders the source without removed structured sections", () => {
  const markdown = toMarkdown([{ ...createJob(source), skills: ["C#", "SQL"] }]);
  assert.match(markdown, /## Description\n\nRequirements:\n5\+ years experience/);
  assert.doesNotMatch(markdown, /## Skills|## Requirements|## Responsibilities|## Notes/);
});

test("malformed extractor JSON is rejected without changing the capture", () => {
  assert.throws(() => parseRefinement({
    requirements: [],
    responsibilities: [],
    skills: [],
    raw_model_output: "{not json"
  }), /malformed refinement JSON/);
});

test("refinement timeout stays retryable and is not treated as completed", () => {
  assert.deepEqual(refinementFailure({ name: "TimeoutError" }), {
    state: "interrupted",
    warning: "Refinement timed out; retry manually. The server may have completed the request."
  });
});

test("refinement sends only cleaned text and small metadata to the mocked API", async () => {
  const raw = createJob(source);
  let requested;
  const response = await requestRefinement(async (url, options) => {
    requested = { url, options };
    return { ok: true, json: async () => ({ title: "Engineer", requirements: [] }) };
  }, "https://extractor.example/extract-job", {
    token: "local-test-token",
    timeoutSeconds: 15,
    promptMode: "custom",
    systemPrompt: "Preserve all thresholds.",
    extraInstructions: "Do not summarize."
  }, raw);
  assert.equal(response.title, "Engineer");
  assert.equal(requested.options.method, "POST");
  assert.ok(requested.options.headers.Authorization.startsWith("Bearer "));
  assert.ok(requested.options.signal instanceof AbortSignal);
  assert.deepEqual(Object.keys(JSON.parse(requested.options.body)), [
    "source_url", "site", "page_title", "cleaned_text", "system_prompt_override", "extra_instructions"
  ]);
  assert.equal(JSON.parse(requested.options.body).cleaned_text, source.description_text);
  assert.equal(JSON.stringify(requested).includes("<html"), false);
});

test("direct OpenAI uses the official endpoint and maps chat content into refinement fields", async () => {
  const profile = { provider: "openai", model: "gpt-4.1-mini", token: "test-key", timeoutSeconds: 15 };
  assert.equal(extractionEndpoint(profile), OPENAI_EXTRACT_URL);
  assert.equal(extractionEndpoint({ baseUrl: "https://vps.example", extractPath: "/extract-job" }), "https://vps.example/extract-job");
  let requested;
  const data = await requestRefinement(async (url, options) => {
    requested = { url, options };
    return { ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ title: "Engineer", skills: ["SQL"], requirements: ["5+ years experience"] }) } }] }) };
  }, OPENAI_EXTRACT_URL, profile, createJob(source));
  const body = JSON.parse(requested.options.body);
  assert.equal(requested.url, OPENAI_EXTRACT_URL);
  assert.equal(requested.options.headers.Authorization, "Bearer test-key");
  assert.equal(body.model, profile.model);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.stream, false);
  assert.equal(JSON.parse(body.messages[1].content).cleaned_text, source.description_text);
  assert.match(body.messages[0].content, /numeric thresholds/);
  assert.deepEqual(parseRefinement(data).skills, ["SQL"]);
  assert.equal(JSON.stringify(body).includes(profile.token), false);
});

test("direct OpenAI validates configuration before sending credentials", async () => {
  const fetcher = () => { throw new Error("Must not send a request"); };
  const profile = { provider: "openai", model: "gpt-4.1-mini", token: "test-key", timeoutSeconds: 15 };
  await assert.rejects(requestRefinement(fetcher, "https://other.example", profile, createJob(source)), /api.openai.com/);
  await assert.rejects(requestRefinement(fetcher, OPENAI_EXTRACT_URL, { ...profile, token: "" }, createJob(source)), /API key and model/);
  await assert.rejects(requestRefinement(fetcher, OPENAI_EXTRACT_URL, { ...profile, model: "" }, createJob(source)), /API key and model/);
});

test("direct OpenAI rejects unusable responses and reports billing errors", async () => {
  const profile = { provider: "openai", model: "gpt-4.1-mini", token: "test-key", timeoutSeconds: 15 };
  for (const [choice, message] of [
    [{ finish_reason: "length", message: { content: "{}" } }, /truncated/],
    [{ message: { refusal: "Declined" } }, /declined/],
    [{ message: { content: "" } }, /no extraction content/],
    [{ message: { content: "{invalid" } }, /malformed refinement JSON/]
  ]) {
    await assert.rejects(requestRefinement(async () => ({ ok: true, json: async () => ({ choices: [choice] }) }), OPENAI_EXTRACT_URL, profile, createJob(source)), message);
  }
  await assert.rejects(requestRefinement(async () => ({ ok: false, status: 429 }), OPENAI_EXTRACT_URL, profile, createJob(source)), /billing, quota, and rate limits/);
});

test("a mocked request timeout is reported as interrupted, not completed", async () => {
  await assert.rejects(
    requestRefinement(async () => { throw new DOMException("Timed out", "TimeoutError"); }, "https://extractor.example/extract-job", {
      timeoutSeconds: 10, promptMode: "server"
    }, createJob(source)),
    (error) => refinementFailure(error).state === "interrupted"
  );
});
