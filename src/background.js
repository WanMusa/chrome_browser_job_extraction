import { createJob } from "./model.js";
import { loadState, saveState } from "./storage.js";

chrome.runtime.onInstalled.addListener(() => {
  Promise.resolve(chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SAVE_CAPTURE") return;
  (async () => {
    const state = await loadState();
    const job = createJob(message.captured || {});
    const duplicate = state.jobs.find((item) => item.source_url && item.source_url === job.source_url);
    if (duplicate) job.warnings.push("A job with this source URL is already saved; this capture was added separately.");
    state.jobs.unshift(job);
    await saveState(state);
    sendResponse({ ok: true, jobId: job.id, duplicate: Boolean(duplicate) });
  })().catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
