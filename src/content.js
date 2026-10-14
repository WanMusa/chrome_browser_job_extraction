(() => {
  if (globalThis.__jobCaptureListenerInstalled) return;
  globalThis.__jobCaptureListenerInstalled = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "CAPTURE_VISIBLE_PAGE") return;
    try {
      const selection = typeof message.selectionText === "string" ? message.selectionText : window.getSelection()?.toString() || "";
      sendResponse({ ok: true, captured: globalThis.JobCaptureCore.extractPage(document, location, selection, message.mode) });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || "Could not read this page." });
    }
    return true;
  });
})();
