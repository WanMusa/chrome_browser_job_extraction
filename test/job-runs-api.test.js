import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchCoverLetterUrl,
  fetchJobRuns,
  fetchResumeUrl,
  regenerateJobRun,
  retryJobRun
} from "../src/job-runs-api.js";

const config = { baseUrl: "https://wanagents.example", token: "separate-jobs-token" };

test("lists runs with the scoped token and fixed newest-runs endpoint", async () => {
  let request;
  const result = await fetchJobRuns(async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => [{ id: "run-1", status: "completed" }] };
  }, config);

  assert.equal(request.url, "https://wanagents.example/resume/job-runs");
  assert.equal(request.options.method, undefined);
  assert.equal(request.options.headers.Authorization, "Bearer separate-jobs-token");
  assert.deepEqual(result, [{ id: "run-1", status: "completed" }]);
});

test("retry and paid regeneration use distinct endpoints", async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 202, json: async () => ({ status: "queued" }) };
  };

  await retryJobRun(fetcher, config, "run/one");
  await regenerateJobRun(fetcher, config, "run/one");

  assert.equal(requests[0].url, "https://wanagents.example/resume/job-runs/run%2Fone/retry");
  assert.equal(requests[1].url, "https://wanagents.example/resume/job-runs/run%2Fone/regenerate?confirm_paid_generation=true");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[1].options.method, "POST");
});

test("resume URL is fetched on demand and must be HTTPS", async () => {
  let called = 0;
  const result = await fetchResumeUrl(async (url) => {
    called++;
    assert.equal(url, "https://wanagents.example/resume/job-runs/run-1/resume-url");
    return { ok: true, status: 200, json: async () => ({ url: "https://storage.example/signed.docx", expires_in: 300 }) };
  }, config, "run-1");
  assert.equal(called, 1);
  assert.equal(result.expires_in, 300);
  await assert.rejects(fetchResumeUrl(async () => ({
    ok: true, status: 200, json: async () => ({ url: "http://storage.example/file", expires_in: 300 })
  }), config, "run-1"), /not HTTPS/);
});

test("rejects invalid URL, missing token, and API errors without exposing response bodies", async () => {
  await assert.rejects(fetchJobRuns(() => { throw new Error("must not fetch"); }, { ...config, baseUrl: "http://wanagents.example" }), /HTTPS/);
  await assert.rejects(fetchJobRuns(() => { throw new Error("must not fetch"); }, { ...config, token: " " }), /token/);
  await assert.rejects(fetchJobRuns(async () => ({ ok: false, status: 503, json: async () => ({ detail: "private" }) }), config), /503/);
});

test("cover letter URL is fetched from its own signed-download endpoint", async () => {
  let requestUrl;
  const result = await fetchCoverLetterUrl(async (url) => {
    requestUrl = url;
    return { ok: true, status: 200,
      json: async () => ({ url: "https://storage.example/cover-letter.docx", expires_in: 300 }) };
  }, config, "run-1");
  assert.equal(requestUrl, "https://wanagents.example/resume/job-runs/run-1/cover-letter-url");
  assert.equal(result.expires_in, 300);
  await assert.rejects(fetchCoverLetterUrl(async () => ({
    ok: true, status: 200,
    json: async () => ({ url: "http://storage.example/cover-letter.docx", expires_in: 300 })
  }), config, "run-1"), /not HTTPS/);
});