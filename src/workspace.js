import { exportJob, normalizeState, SCHEMA_VERSION } from "./model.js";
import { loadState, saveState } from "./storage.js";
import { exportFilename, toCsv, toMarkdown } from "./export.js";

let state;
let selectedId = null;

const $ = (selector) => document.querySelector(selector);
const notice = (text) => { $("#notice").textContent = text; };
const handle = (action) => (...args) => Promise.resolve().then(() => action(...args)).catch((error) => notice(error.message || "Operation failed."));

function endpoint(profile) {
  const base = profile.baseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(base)) throw new Error("Configure an HTTPS inbox URL in Settings first.");
  const url = new URL(profile.path, `${base}/`);
  if (url.origin !== new URL(base).origin) throw new Error("Inbox paths must stay on the configured origin.");
  return url.href;
}

async function ensureOriginPermission(url) {
  const accepted = await chrome.permissions.request({ origins: [`${new URL(url).origin}/*`] });
  if (!accepted) throw new Error("Chrome host access was not granted.");
}

function safeText(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text || "";
  if (className) element.className = className;
  return element;
}

function renderJobs() {
  const list = $("#job-list");
  const checked = new Set([...list.querySelectorAll("input:checked")].map((input) => input.dataset.jobId));
  list.replaceChildren();
  $("#job-count").textContent = `(${state.jobs.length})`;
  $("#send-selected").disabled = !(state.settings.inbox.enabled && state.settings.inbox.baseUrl && state.settings.inbox.path);
  if (!state.jobs.length) list.append(safeText("p", "No jobs captured yet."));
  for (const job of state.jobs) {
    const row = document.createElement("div");
    row.className = `job-row${selectedId === job.id ? " selected" : ""}`;
    row.dataset.jobId = job.id;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.jobId = job.id;
    checkbox.checked = checked.has(job.id);
    checkbox.setAttribute("aria-label", `Select ${job.title || "captured job"}`);
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    row.append(checkbox);
    const text = document.createElement("div");
    text.append(safeText("span", job.title || "Untitled advert", "job-title"));
    text.append(safeText("small", [job.company, job.location].filter(Boolean).join(" · ") || job.site));
    row.append(text);
    row.addEventListener("click", () => {
      selectedId = job.id;
      document.querySelectorAll(".job-row").forEach((item) => item.classList.toggle("selected", item.dataset.jobId === selectedId));
      renderDetail();
    });
    list.append(row);
  }
  renderDetail();
}

function makeInput(label, value, key, multiline = false) {
  const wrapper = document.createElement("label");
  wrapper.textContent = label;
  const input = document.createElement(multiline ? "textarea" : "input");
  input.value = value || "";
  input.dataset.field = key;
  if (multiline) input.rows = 18;
  wrapper.append(input);
  return wrapper;
}

function renderDetail() {
  const panel = $("#job-detail");
  panel.replaceChildren();
  const job = state.jobs.find((item) => item.id === selectedId);
  if (!job) {
    panel.append(safeText("p", "Select a job to review it."));
    return;
  }
  panel.append(safeText("h2", job.title || "Untitled advert"));
  const metadata = document.createElement("div");
  metadata.className = "meta";
  metadata.append(
    makeInput("Title", job.title, "title"),
    makeInput("Company", job.company, "company"),
    makeInput("Location", job.location, "location"),
    makeInput("Employment type", job.employment_type, "employment_type"),
    makeInput("Salary", job.salary_text, "salary_text")
  );
  panel.append(metadata);
  panel.append(makeInput("Job description", job.description_text, "description_text", true));
  panel.append(safeText("p", `Source: ${job.site} · Captured ${job.captured_at}`));
  if (job.source_url) {
    const link = document.createElement("a");
    link.href = job.source_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open original advert";
    panel.append(link);
  }
}

async function updateDetail(event) {
  const key = event.target.dataset.field;
  if (!["title", "company", "location", "employment_type", "salary_text", "description_text"].includes(key)) return;
  const job = state.jobs.find((item) => item.id === selectedId);
  if (!job) return;
  job[key] = key === "description_text" ? event.target.value : event.target.value.trim() || null;
  await persist();
}

async function persist() {
  await saveState(state);
}

function selectedJobs() {
  const checked = new Set([...document.querySelectorAll("#job-list input[type=checkbox]:checked")].map((input) => input.dataset.jobId));
  return state.jobs.filter((job) => checked.has(job.id));
}

async function downloadJobs(jobs) {
  if (!jobs.length) return notice("Select at least one job to export.");
  const { format, saveAs } = state.settings.export;
  const safeJobs = jobs.map(exportJob);
  const batches = format === "json" ? safeJobs.map((job) => [job]) : [safeJobs];
  const date = new Date();
  const mime = format === "json" ? "application/json" : format === "csv" ? "text/csv" : "text/markdown";
  let exported = 0;
  try {
    for (const batch of batches) {
      const content = format === "json"
        ? JSON.stringify({ schema_version: SCHEMA_VERSION, exported_at: date.toISOString(), jobs: batch }, null, 2)
        : format === "csv" ? toCsv(batch) : toMarkdown(batch);
      const objectUrl = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
      try {
        await chrome.downloads.download({ url: objectUrl, filename: exportFilename(batch, format, date), saveAs, conflictAction: "uniquify" });
        exported += batch.length;
      } finally {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      }
    }
    notice(`Exported ${exported} job${exported === 1 ? "" : "s"} as ${format.toUpperCase()}.`);
  } catch (error) {
    notice(`Export stopped after ${exported} job${exported === 1 ? "" : "s"}: ${error.message}`);
  }
}

async function sendSelected() {
  const jobs = selectedJobs();
  const inbox = state.settings.inbox;
  if (!jobs.length) return notice("Select at least one job to send.");
  if (!inbox.enabled || !inbox.baseUrl || !inbox.path) return notice("Configure and enable an inbox in Settings first.");
  const url = endpoint(inbox);
  await ensureOriginPermission(url);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(inbox.token ? { Authorization: `Bearer ${inbox.token}` } : {}) },
    body: JSON.stringify({ schema_version: SCHEMA_VERSION, jobs: jobs.map(exportJob) }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Inbox rejected the batch (${response.status}).`);
  notice(`Sent ${jobs.length} job${jobs.length === 1 ? "" : "s"} to the configured inbox.`);
}

function field(form, name) {
  return form.elements.namedItem(name);
}

function populateSettings() {
  const form = $("#settings-form");
  const { inbox, export: exportSettings } = state.settings;
  for (const [name, value] of Object.entries({
    format: exportSettings.format,
    saveAs: exportSettings.saveAs,
    inboxEnabled: inbox.enabled,
    inboxBaseUrl: inbox.baseUrl,
    inboxPath: inbox.path,
    inboxToken: inbox.token
  })) {
    const control = field(form, name);
    if (control.type === "checkbox") control.checked = Boolean(value);
    else control.value = value ?? "";
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const inbox = {
    baseUrl: field(form, "inboxBaseUrl").value.trim(),
    path: field(form, "inboxPath").value.trim() || "/jobs",
    token: field(form, "inboxToken").value,
    enabled: field(form, "inboxEnabled").checked
  };
  if (inbox.baseUrl) {
    const url = endpoint(inbox);
    if (inbox.enabled) await ensureOriginPermission(url);
  }
  state.settings.inbox = inbox;
  state.settings.export = { format: field(form, "format").value, saveAs: field(form, "saveAs").checked };
  await persist();
  renderJobs();
  notice("Settings saved on this device.");
}

async function init() {
  state = await loadState();
  populateSettings();
  renderJobs();
  $("#export-selected").addEventListener("click", handle(() => downloadJobs(selectedJobs())));
  $("#export-all").addEventListener("click", handle(() => downloadJobs(state.jobs)));
  $("#delete-selected").addEventListener("click", handle(async () => {
    const ids = new Set(selectedJobs().map((job) => job.id));
    if (!ids.size) return notice("Select jobs to delete.");
    if (!confirm(`Delete ${ids.size} selected job${ids.size === 1 ? "" : "s"} from this device?`)) return;
    state.jobs = state.jobs.filter((job) => !ids.has(job.id));
    selectedId = null;
    await persist();
    renderJobs();
    notice("Selected jobs deleted.");
  }));
  $("#clear-all").addEventListener("click", handle(async () => {
    if (!state.jobs.length) return notice("The job basket is already empty.");
    if (!confirm(`Delete all ${state.jobs.length} saved jobs from this device?`)) return;
    state.jobs = [];
    selectedId = null;
    await persist();
    renderJobs();
    notice("All saved jobs deleted.");
  }));
  $("#send-selected").addEventListener("click", handle(sendSelected));
  $("#job-detail").addEventListener("change", handle(updateDetail));
  $("#settings-form").addEventListener("submit", handle(saveSettings));
  document.querySelectorAll(".tabs button").forEach((button) => button.addEventListener("click", () => {
    const settings = button.dataset.view === "settings";
    $("#jobs-view").hidden = settings;
    $("#settings-view").hidden = !settings;
    document.querySelectorAll(".tabs button").forEach((tab) => tab.classList.toggle("active", tab === button));
  }));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.jobCaptureState?.newValue) return;
    state = normalizeState(changes.jobCaptureState.newValue);
    if (!state.jobs.some((job) => job.id === selectedId)) selectedId = null;
    renderJobs();
  });
}

init().catch((error) => notice(`Could not open job storage: ${error.message}`));