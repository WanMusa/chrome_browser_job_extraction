import test from "node:test";
import assert from "node:assert/strict";
import { createJob, exportJob } from "../src/model.js";
import { toCsv, toMarkdown } from "../src/export.js";
import { parseRefinement, refinementFailure } from "../src/refinement.js";
import { requestRefinement } from "../src/extraction-api.js";

const source = {
  source_url: "https://example.com/job/1",
  site: "other",
  title: "Engineer",
  description_text: "Requirements:\n5+ years experience\nExperience with C#, SQL"
};

test("raw and refined exports retain the same lean outer schema and source text", () => {
  const raw = createJob(source);
  const refined = { ...raw, extraction_mode: "llm_refined", requirements: ["5+ years experience"] };
  const rawPayload = exportJob(raw);
  const refinedPayload = exportJob(refined);
  assert.deepEqual(Object.keys(rawPayload), Object.keys(refinedPayload));
  assert.equal(rawPayload.description_text, source.description_text);
  assert.equal(refinedPayload.description_text, source.description_text);
  assert.equal(rawPayload.extraction_mode, "raw");
  assert.equal(refinedPayload.extraction_mode, "llm_refined");
});

test("CSV escapes quotes and preserves multiline cells", () => {
  const csv = toCsv([{ ...createJob(source), title: 'Engineer "II"', description_text: "line one\nline two" }]);
  assert.match(csv, /"Engineer ""II"""/);
  assert.match(csv, /"line one\nline two"/);
});

test("Markdown renders the source and optional refined fields", () => {
  const markdown = toMarkdown([{ ...createJob(source), skills: ["C#", "SQL"] }]);
  assert.match(markdown, /## Description\n\nRequirements:\n5\+ years experience/);
  assert.match(markdown, /## Skills\n\n- C#\n- SQL/);
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

test("a mocked request timeout is reported as interrupted, not completed", async () => {
  await assert.rejects(
    requestRefinement(async () => { throw new DOMException("Timed out", "TimeoutError"); }, "https://extractor.example/extract-job", {
      timeoutSeconds: 10, promptMode: "server"
    }, createJob(source)),
    (error) => refinementFailure(error).state === "interrupted"
  );
});
