import { createJob } from "./model.js";
import { loadState, saveState } from "./storage.js";

let pendingSave = Promise.resolve();

function storeCapture(captured) {
  const save = pendingSave.then(async () => {
    const state = await loadState();
    const job = createJob(captured || {});
    const duplicate = state.jobs.some((item) => item.source_url && item.source_url === job.source_url);
    state.jobs.unshift(job);
    await saveState(state);
    return { ok: true, jobId: job.id, duplicate };
  });
  pendingSave = save.catch(() => {});
  return save;
}

export async function captureTab(tab, mode = "page", selectionText) {
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || "")) throw new Error("Open a job advert in a normal browser tab first.");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/capture-core.js", "src/content.js"] });
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "CAPTURE_VISIBLE_PAGE", mode,
    ...(typeof selectionText === "string" ? { selectionText } : {})
  });
  if (!response?.ok) throw new Error(response?.error || "Could not capture this page.");
  if (!response.captured?.description_text?.trim()) throw new Error("No readable job text found. Select the advert text and try again.");
  return storeCapture(response.captured);
}

async function feedback(tab, text, title, color) {
  if (!tab?.id) return;
  await Promise.all([
    chrome.action.setBadgeText({ tabId: tab.id, text }),
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color }),
    chrome.action.setTitle({ tabId: tab.id, title })
  ]);
}

async function runCapture(tab, mode, selectionText) {
  try {
    if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await feedback(tab, "...", "Capturing job…", "#2457a7").catch(() => {});
    const saved = await captureTab(tab, mode, selectionText);
    await feedback(tab, "OK", saved.duplicate ? "Job saved; a separate capture of this URL already exists." : "Job saved locally. Open the workspace to review it.", "#27804a").catch(() => {});
    return saved;
  } catch (error) {
    await feedback(tab, "!", `Capture failed: ${error.message}`, "#a63232").catch(() => {});
    return { ok: false, error: error.message };
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await Promise.resolve(chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })).catch(() => {});
  await chrome.contextMenus.removeAll();
  const documentUrlPatterns = ["http://*/*", "https://*/*"];
  chrome.contextMenus.create({ id: "capture-job-page", title: "Capture job page", contexts: ["page", "link", "image", "frame"], documentUrlPatterns });
  chrome.contextMenus.create({ id: "capture-job-selection", title: "Capture selected job text", contexts: ["selection"], documentUrlPatterns });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "capture-job-page") return runCapture(tab, "page");
  if (info.menuItemId === "capture-job-selection") return runCapture(tab, "selection", info.selectionText);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "capture-job-page") return runCapture(tab, "page");
  if (command === "capture-job-selection") return runCapture(tab, "selection");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!["SAVE_CAPTURE", "CAPTURE_JOB"].includes(message?.type)) return;
  const task = message.type === "CAPTURE_JOB"
    ? runCapture(null, message.mode === "selection" ? "selection" : "page")
    : storeCapture(message.captured);
  task.then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
