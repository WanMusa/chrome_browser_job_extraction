import { SCHEMA_VERSION } from "./model.js";

export async function submitJobBatch(fetcher, url, token, jobs) {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ schema_version: SCHEMA_VERSION, jobs }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Inbox rejected the batch (${response.status}).`);

  let receipt;
  try {
    receipt = await response.json();
  } catch {
    throw new Error("The endpoint returned success without a Resume Builder batch receipt. Check that the inbox path is /resume/batches.");
  }
  if (!receipt || typeof receipt.id !== "string" || !Array.isArray(receipt.job_ids)) {
    throw new Error("The endpoint returned success without a Resume Builder batch receipt. Check that the inbox path is /resume/batches.");
  }
  return {
    batchId: receipt.id,
    acceptedCount: receipt.job_ids.length,
    rejectedCount: Array.isArray(receipt.errors) ? receipt.errors.length : 0
  };
}
