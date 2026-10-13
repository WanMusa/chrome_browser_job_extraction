const message = document.querySelector("#message");

async function capture(mode) {
  message.textContent = "Reading visible page text…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/.test(tab.url || "")) throw new Error("Open a job advert in a normal browser tab first.");
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/capture-core.js", "src/content.js"]
    });
    const response = await chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_VISIBLE_PAGE", mode });
    if (!response?.ok) throw new Error(response?.error || "Could not capture this page.");
    if (!response.captured.description_text) throw new Error("No readable job text found. Select the advert text and try again.");
    const saved = await chrome.runtime.sendMessage({ type: "SAVE_CAPTURE", captured: response.captured });
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
