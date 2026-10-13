import { normalizeState } from "./model.js";

const STATE_KEY = "jobCaptureState";

export async function loadState() {
  const result = await chrome.storage.local.get(STATE_KEY);
  const raw = result[STATE_KEY];
  const state = normalizeState(raw);
  if (!raw || raw.schemaVersion !== state.schemaVersion) await saveState(state);
  return state;
}

export async function saveState(state) {
  const normalized = normalizeState(state);
  await chrome.storage.local.set({ [STATE_KEY]: normalized });
  return normalized;
}
