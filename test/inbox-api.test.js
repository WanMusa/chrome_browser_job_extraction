import test from "node:test";
import assert from "node:assert/strict";
import { submitJobBatch } from "../src/inbox-api.js";

const jobs = [{ id: "capture-1", title: "Analyst" }];

test("confirms Resume Builder accepted a batch before reporting success", async () => {
  let request;
  const receipt = await submitJobBatch(async (url, options) => {
    request = { url, options };
    return { ok: true, status: 201, json: async () => ({ id: "batch-1", job_ids: ["run-1"], errors: [] }) };
  }, "https://wanagents.example/resume/batches", "inbox-token", jobs);

  assert.equal(request.url, "https://wanagents.example/resume/batches");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer inbox-token");
  assert.equal(JSON.parse(request.options.body).schema_version, 2);
  assert.deepEqual(receipt, { batchId: "batch-1", acceptedCount: 1, rejectedCount: 0 });
});

test("does not report success for an unrelated endpoint that returns HTTP 200", async () => {
  await assert.rejects(submitJobBatch(async () => ({
    ok: true, status: 200, json: async () => ({ status: "ok" })
  }), "https://wanagents.example/", "inbox-token", jobs), /Resume Builder batch receipt/);
});

test("reports partial batch acceptance rather than claiming every job was sent", async () => {
  const receipt = await submitJobBatch(async () => ({
    ok: true, status: 201, json: async () => ({ id: "batch-2", job_ids: ["run-1"], errors: [{ index: 1 }] })
  }), "https://wanagents.example/resume/batches", "inbox-token", [jobs[0], { id: "capture-2" }]);

  assert.deepEqual(receipt, { batchId: "batch-2", acceptedCount: 1, rejectedCount: 1 });
});

test("surfaces non-success HTTP responses", async () => {
  await assert.rejects(submitJobBatch(async () => ({ ok: false, status: 401 }),
    "https://wanagents.example/resume/batches", "inbox-token", jobs), /401/);
});
