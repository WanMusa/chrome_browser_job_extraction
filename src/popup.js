const message = document.querySelector("#message");

async function capture(mode) {
  message.textContent = "Reading visible page text…";
  try {
    const saved = await chrome.runtime.sendMessage({ type: "CAPTURE_JOB", mode });
    if (!saved?.ok) throw new Error(saved?.error || "Could not save the capture.");
    message.textContent = saved.duplicate
      ? "Saved. This URL was already in your basket; the new capture was kept separately."
      : "Job saved locally. You can review it in the workspace.";
  } catch (error) {
    message.textContent = error?.message || "Capture failed.";
  }
}

document.querySelector("#capture-page").addEventListener("click", () => capture("page"));
document.querySelector("#capture-selection").addEventListener("click", () => capture("selection"));
document.querySelector("#open-workspace").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("workspace.html") });
});
