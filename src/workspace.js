import { exportJob } from "./model.js";
import { loadState, saveState } from "./storage.js";
import { StatusMonitor, statusIsStale } from "./lifecycle.js";
import { toCsv, toMarkdown } from "./export.js";
import { parseRefinement, refinementFailure } from "./refinement.js";
import { requestRefinement } from "./extraction-api.js";

let state;
let selectedId = null;
let modelState = "unknown";
let statusUpdatedAt = 0;
let lastActivity = Date.now();
let monitor = null;
let refining = false;

const $ = (selector) => document.querySelector(selector);
const notice = (text) => { $("#notice").textContent = text; };

function markActivity() {
  lastActivity = Date.now();
  monitor?.touch();
}

function endpoint(profile, path) {
  const base = profile.baseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(base)) throw new Error("Configure an HTTPS base URL in Settings first.");
  const endpointUrl = new URL(path, `${base}/`);
  if (endpointUrl.origin !== new URL(base).origin) throw new Error("Endpoint paths must stay on the configured API origin.");
  return endpointUrl.href;
}

async function ensureOriginPermission(url, requestFromUserAction = false) {
  const origin = `${new URL(url).origin}/*`;
  if (requestFromUserAction) {
    const accepted = await chrome.permissions.request({ origins: [origin] });
    if (!accepted) throw new Error("Chrome host access was not granted.");
    return;
  }
  const granted = await chrome.permissions.contains({ origins: [origin] });
  if (!granted) {
    throw new Error("Grant Chrome host access by saving Settings or using the model button.");
  }
}

function apiHeaders(profile) {
  return {
    "Content-Type": "application/json",
    ...(profile.token ? { Authorization: "Bearer " + profile.token } : {})
  };
}

function setModelState(next, detail = "") {
  modelState = next;
  statusUpdatedAt = Date.now();
  const button = $("#model-status");
  button.className = `status ${next}`;
  button.textContent = ({
    unknown: "Check model",
    sleeping: "Wake model",
    warming: "Warming…",
    ready: "Model ready",
    unavailable: "Model unavailable"
  })[next] || "Check model";
  button.title = detail || ({
    unknown: "Check model status",
    sleeping: "Model is sleeping. Activate to wake it.",
    warming: "Model is warming up; status checks are limited to this interval.",
    ready: "Model is ready. Activate to refresh status.",
    unavailable: "Model status is unavailable. Activate to retry."
  })[next];
  monitor?.observe(next, () => checkModel().catch(showApiError));
}

function isMonitoringIdle() {
  return monitor?.isIdle() ?? (Date.now() - lastActivity >= state.settings.inactivityMinutes * 60_000);
}

async function checkModel() {
  const profile = state.settings.extraction;
  if (!profile.supportsStatus) {
    setModelState("unknown", "Status endpoint is disabled in Settings.");
    return;
  }
  if (isMonitoringIdle()) {
    monitor?.markStale();
    return;
  }
  const url = endpoint(profile, profile.statusPath);
  await ensureOriginPermission(url);
  const response = await fetch(url, {
    method: "GET",
    headers: apiHeaders(profile),
    signal: AbortSignal.timeout(Math.min(profile.timeoutSeconds * 1000, 20_000))
  });
  if (!response.ok) throw new Error(`Status check failed (${response.status}).`);
  const data = await response.json();
  if (!["ready", "sleeping", "warming", "unavailable"].includes(data.state)) {
    throw new Error("Status endpoint returned an unrecognized state.");
  }
  setModelState(data.state, data.error || "");
}

function showApiError(error) {
  setModelState("unavailable", error?.message || "Connection failed.");
  notice(error?.message || "Connection failed.");
}

async function onModelButton() {
  markActivity();
  try {
    const profile = state.settings.extraction;
    if (profile.supportsStatus && modelState !== "sleeping") {
      await ensureOriginPermission(endpoint(profile, profile.statusPath), true);
      await checkModel();
      return;
    }
    if (!profile.supportsWake) {
      await ensureOriginPermission(endpoint(profile, profile.statusPath), true);
      await checkModel();
      return;
    }
    const url = endpoint(profile, profile.wakePath);
    await ensureOriginPermission(url, true);
    const response = await fetch(url, {
      method: "POST",
      headers: apiHeaders(profile),
      signal: AbortSignal.timeout(Math.min(profile.timeoutSeconds * 1000, 20_000))
    });
    if (!response.ok) throw new Error(`Wake request failed (${response.status}).`);
    const data = await response.json();
    const next = ["ready", "sleeping", "warming", "unavailable"].includes(data.state) ? data.state : "warming";
    setModelState(next, data.error || "");
  } catch (error) {
    showApiError(error);
  }
}

function safeText(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text || "";
  if (className) element.className = className;
  return element;
}

function renderJobs() {
  const list = $("#job-list");
  list.replaceChildren();
  $("#job-count").textContent = `(${state.jobs.length})`;
  $("#llm-enabled").checked = state.settings.llmEnabled;
  $("#send-selected").disabled = !(
    state.settings.inbox.enabled && state.settings.inbox.baseUrl && state.settings.inbox.path
  );
  if (!state.jobs.length) {
    list.append(safeText("p", "No jobs captured yet."));
    renderDetail();
    return;
  }
  for (const job of state.jobs) {
    const row = document.createElement("div");
    row.className = `job-row${selectedId === job.id ? " selected" : ""}`;
    row.dataset.jobId = job.id;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.jobId = job.id;
    checkbox.setAttribute("aria-label", `Select ${job.title || "captured job"}`);
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    row.append(checkbox);
    const text = document.createElement("div");
    text.append(safeText("span", job.title || "Untitled advert", "job-title"));
    text.append(safeText("small", [job.company, job.location].filter(Boolean).join(" · ") || job.site));
    text.append(safeText("small", job.operationState || job.extraction_mode));
    row.append(text);
    row.addEventListener("click", () => {
      selectedId = job.id;
      markActivity();
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
  if (key === "description_text") input.rows = 18;
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
  panel.append(makeInput("Cleaned source text (source of truth)", job.description_text, "description_text", true));
  const fields = [
    ["Requirements", "requirements"],
    ["Responsibilities", "responsibilities"],
    ["Skills", "skills"]
  ];
  for (const [label, key] of fields) panel.append(makeInput(`${label} (one per line)`, (job[key] || []).join("\n"), key, true));
  panel.append(makeInput("Notes", job.notes, "notes", true));
  if (job.warnings?.length) {
    const warnings = document.createElement("ul");
    warnings.className = "warning";
    for (const warning of job.warnings) warnings.append(safeText("li", warning));
    panel.append(warnings);
  }
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
  if (!key) return;
  const current = state.jobs.find((item) => item.id === selectedId);
  if (!current) return;
  const value = event.target.value;
  if (["requirements", "responsibilities", "skills"].includes(key)) {
    current[key] = value.split("\n").map((line) => line.trim()).filter(Boolean);
  } else {
    current[key] = value.trim() || null;
    if (key === "description_text") current[key] = value;
  }
  await persist();
}

async function persist() {
  state = await saveState(state);
}

function selectedJobs() {
  const checked = new Set([...document.querySelectorAll("#job-list input[type=checkbox]:checked")].map((input) => input.dataset.jobId));
  return state.jobs.filter((job) => checked.has(job.id));
}

function exportFilename(format) {
  const date = new Date().toISOString().slice(0, 10);
  const stem = state.settings.export.filenamePattern.replaceAll("{date}", date).replace(/[^a-zA-Z0-9._-]+/g, "-") || `jobs-${date}`;
  return `${stem}.${format === "markdown" ? "md" : format}`;
}

async function downloadJobs(jobs) {
  if (!jobs.length) {
    notice("Select at least one job to export.");
    return;
  }
  const { format, includeRefinedArrays, saveAs } = state.settings.export;
  const safeJobs = jobs.map((job) => exportJob(job, includeRefinedArrays));
  const mime = format === "json" ? "application/json" : format === "csv" ? "text/csv" : "text/markdown";
  const content = format === "json"
    ? JSON.stringify({ schema_version: 1, exported_at: new Date().toISOString(), jobs: safeJobs }, null, 2)
    : format === "csv" ? toCsv(safeJobs, includeRefinedArrays) : toMarkdown(safeJobs, includeRefinedArrays);
  const objectUrl = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  try {
    await chrome.downloads.download({ url: objectUrl, filename: exportFilename(format), saveAs });
    notice(`Exported ${jobs.length} job${jobs.length === 1 ? "" : "s"} as ${format.toUpperCase()}.`);
  } catch (error) {
    notice(`Export failed: ${error.message}`);
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}

async function refine(job) {
  if (!state.settings.llmEnabled) throw new Error("Enable LLM refinement in Settings or the Jobs toolbar first.");
  const profile = state.settings.extraction;
  if (job.description_text.length > profile.maxInputChars) {
    throw new Error(`This advert is ${job.description_text.length} characters, above your ${profile.maxInputChars} character warning budget. Edit it before refining.`);
  }
  if (profile.supportsStatus && modelState !== "ready") {
    if (modelIsStale()) await checkModel();
    if (modelState !== "ready") throw new Error("The model is not ready. Use the model status button to check or wake it, then retry.");
  } else if (profile.supportsStatus && modelIsStale()) {
    await checkModel();
    if (modelState !== "ready") throw new Error("The model is not ready. Use the model status button to check or wake it, then retry.");
  }
  const url = endpoint(profile, profile.extractPath);
  await ensureOriginPermission(url);
  job.operationState = "refining";
  await persist();
  renderJobs();
  try {
    const data = await requestRefinement(fetch, url, profile, job);
    const result = parseRefinement(data);
    for (const key of ["title", "company", "location", "salary_text", "employment_type"]) {
      if (result[key]) job[key] = result[key];
    }
    for (const key of ["requirements", "responsibilities", "skills", "notes"]) job[key] = result[key];
    if (Array.isArray(data.warnings)) job.warnings = [...new Set([...job.warnings, ...data.warnings.filter((item) => typeof item === "string")])];
    job.extraction_mode = "llm_refined";
    job.operationState = "refined";
    await persist();
    notice(`Refined ${job.title || "job"}; cleaned source text was preserved.`);
  } catch (error) {
    const failure = refinementFailure(error);
    job.operationState = failure.state;
    job.warnings = [...job.warnings, failure.warning];
    await persist();
    throw error;
  } finally {
    renderJobs();
  }
}

function modelIsStale() {
  return modelState === "unknown" || modelState === "unavailable" || statusIsStale(statusUpdatedAt);
}

async function refineSelected() {
  markActivity();
  if (refining) return;
  const jobs = selectedJobs();
  if (!jobs.length) {
    notice("Select one or more jobs to refine.");
    return;
  }
  refining = true;
  $("#refine-selected").disabled = true;
  for (const job of jobs) {
    try { await refine(job); }
    catch (error) { notice(`${job.title || "Job"}: ${error.message}`); }
  }
  refining = false;
  $("#refine-selected").disabled = false;
}

async function sendSelected() {
  markActivity();
  const jobs = selectedJobs();
  const inbox = state.settings.inbox;
  if (!jobs.length) return notice("Select at least one job to send.");
  if (!inbox.enabled || !inbox.baseUrl || !inbox.path) return notice("Configure and enable an inbox in Settings first.");
  try {
    const url = endpoint(inbox, inbox.path);
    await ensureOriginPermission(url, true);
    const response = await fetch(url, {
      method: "POST",
      headers: apiHeaders(inbox),
      body: JSON.stringify({ schema_version: 1, jobs: jobs.map((job) => exportJob(job, true)) }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`Inbox rejected the batch (${response.status}).`);
    notice(`Sent ${jobs.length} job${jobs.length === 1 ? "" : "s"} to the configured inbox.`);
  } catch (error) {
    notice(`Inbox send failed: ${error.message}`);
  }
}

function field(form, name) {
  return form.elements.namedItem(name);
}

function populateSettings() {
  const form = $("#settings-form");
  const { extraction, inbox, export: exportSettings } = state.settings;
  for (const [name, value] of Object.entries({
    llmEnabled: state.settings.llmEnabled,
    baseUrl: extraction.baseUrl,
    token: extraction.token,
    extractPath: extraction.extractPath,
    statusPath: extraction.statusPath,
    wakePath: extraction.wakePath,
    timeoutSeconds: extraction.timeoutSeconds,
    maxInputChars: extraction.maxInputChars,
    inactivityMinutes: state.settings.inactivityMinutes,
    supportsStatus: extraction.supportsStatus,
    supportsWake: extraction.supportsWake,
    promptMode: extraction.promptMode,
    systemPrompt: extraction.systemPrompt,
    extraInstructions: extraction.extraInstructions,
    format: exportSettings.format,
    filenamePattern: exportSettings.filenamePattern,
    saveAs: exportSettings.saveAs,
    includeRefinedArrays: exportSettings.includeRefinedArrays,
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
  markActivity();
  const form = event.currentTarget;
  const number = (name) => Number(field(form, name).value);
  const text = (name) => field(form, name).value.trim();
  const url = text("baseUrl");
  const inboxUrl = text("inboxBaseUrl");
  for (const candidate of [url, inboxUrl].filter(Boolean)) {
    if (!/^https:\/\//i.test(candidate)) return notice("API and inbox base URLs must use HTTPS.");
    try { new URL(candidate); } catch { return notice("Enter valid HTTPS base URLs."); }
  }
  monitor?.markStale();
  if (url && field(form, "llmEnabled").checked) {
    try { await ensureOriginPermission(endpoint({ baseUrl: url }, text("statusPath") || "/llm/status"), true); }
    catch (error) { notice(error.message); }
  }
  state.settings.llmEnabled = field(form, "llmEnabled").checked;
  Object.assign(state.settings.extraction, {
    baseUrl: url,
    token: field(form, "token").value,
    extractPath: text("extractPath") || "/extract-job",
    statusPath: text("statusPath") || "/llm/status",
    wakePath: text("wakePath") || "/llm/wake",
    timeoutSeconds: Math.min(600, Math.max(10, number("timeoutSeconds") || 180)),
    maxInputChars: Math.min(200000, Math.max(1000, number("maxInputChars") || 30000)),
    supportsStatus: field(form, "supportsStatus").checked,
    supportsWake: field(form, "supportsWake").checked,
    promptMode: field(form, "promptMode").value,
    systemPrompt: field(form, "systemPrompt").value,
    extraInstructions: field(form, "extraInstructions").value
  });
  state.settings.inactivityMinutes = Math.min(120, Math.max(1, number("inactivityMinutes") || 10));
  Object.assign(state.settings.export, {
    format: field(form, "format").value,
    filenamePattern: text("filenamePattern") || "jobs-{date}",
    saveAs: field(form, "saveAs").checked,
    includeRefinedArrays: field(form, "includeRefinedArrays").checked
  });
  Object.assign(state.settings.inbox, {
    baseUrl: inboxUrl,
    token: field(form, "inboxToken").value,
    path: text("inboxPath") || "/jobs",
    enabled: field(form, "inboxEnabled").checked
  });
  await persist();
  renderJobs();
  notice("Settings saved on this device.");
  if (state.settings.llmEnabled && state.settings.extraction.supportsStatus) checkModel().catch(showApiError);
  else monitor?.markStale();
}

async function init() {
  state = await loadState();
  const interrupted = state.jobs.filter((job) => job.operationState === "refining");
  for (const job of interrupted) {
    job.operationState = "interrupted";
    job.warnings = [...job.warnings, "Workspace closed during refinement; retry manually. The prior request was not replayed."];
  }
  if (interrupted.length) await persist();
  monitor = new StatusMonitor({
    getInactivityMinutes: () => state.settings.inactivityMinutes,
    onStale: () => setModelState("unknown"),
    onTimeout: () => setModelState("unavailable", "Warmup status polling timed out. Check the model manually.")
  });
  monitor.start();
  populateSettings();
  renderJobs();
  $("#model-status").addEventListener("click", onModelButton);
  $("#llm-enabled").addEventListener("change", async (event) => {
    markActivity();
    state.settings.llmEnabled = event.target.checked;
    if (event.target.checked && state.settings.extraction.baseUrl) {
      try { await ensureOriginPermission(endpoint(state.settings.extraction, state.settings.extraction.statusPath), true); }
      catch (error) { notice(error.message); }
    }
    await persist();
    if (event.target.checked) checkModel().catch(showApiError);
    else monitor.markStale();
  });
  $("#refine-selected").addEventListener("click", refineSelected);
  $("#export-selected").addEventListener("click", () => downloadJobs(selectedJobs()));
  $("#export-all").addEventListener("click", () => downloadJobs(state.jobs));
  $("#delete-selected").addEventListener("click", async () => {
    const ids = new Set(selectedJobs().map((job) => job.id));
    if (!ids.size) return notice("Select jobs to delete.");
    if (!confirm(`Delete ${ids.size} selected job${ids.size === 1 ? "" : "s"} from this device?`)) return;
    state.jobs = state.jobs.filter((job) => !ids.has(job.id));
    selectedId = null;
    await persist();
    renderJobs();
    notice("Selected jobs deleted.");
  });
  $("#clear-all").addEventListener("click", async () => {
    if (!state.jobs.length) return notice("The job basket is already empty.");
    if (!confirm(`Delete all ${state.jobs.length} saved jobs from this device?`)) return;
    state.jobs = [];
    selectedId = null;
    await persist();
    renderJobs();
    notice("All saved jobs deleted.");
  });
  $("#send-selected").addEventListener("click", sendSelected);
  $("#job-detail").addEventListener("change", updateDetail);
  $("#settings-form").addEventListener("submit", saveSettings);
  document.querySelectorAll(".tabs button").forEach((button) => button.addEventListener("click", () => {
    markActivity();
    const settings = button.dataset.view === "settings";
    $("#jobs-view").hidden = settings;
    $("#settings-view").hidden = !settings;
    document.querySelectorAll(".tabs button").forEach((tab) => tab.classList.toggle("active", tab === button));
  }));
  document.addEventListener("pointerdown", markActivity);
  document.addEventListener("keydown", markActivity);
  if (state.settings.llmEnabled && state.settings.extraction.supportsStatus) checkModel().catch(showApiError);
}

window.addEventListener("pagehide", () => {
  monitor?.close();
});

init().catch((error) => notice(`Could not open job storage: ${error.message}`));
