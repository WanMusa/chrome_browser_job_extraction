# Local Job Capture

A Manifest V3 Chrome extension for capturing visible Seek, LinkedIn, and other job advert text into a local review basket. Capture and JSON/CSV/Markdown export work offline. LLM refinement is optional and off by default.

## Install and develop

This project uses plain, locally bundled JavaScript, HTML, and CSS; there are no runtime packages, remote scripts, CDNs, or compilation step.

1. Install Node.js 20 or newer for checks, and clone/open this repository in VS Code.
2. Run `npm test` and `npm run build` from the repository root.
3. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the repository folder containing `manifest.json`.
4. Open a job advert. Use the extension toolbar button to capture the page or selected text. Open the workspace to review/edit jobs, configure settings, refine, and export.

For development updates, run `git pull`, run `npm test` / `npm run build`, then open `chrome://extensions` and click **Reload** for this extension. The extension can be loaded directly from the source tree; `npm run build` performs reproducible syntax checks rather than creating a different package.

## Capture and privacy

- The popup reads rendered page text from the current tab; it does not fetch job URLs or send page HTML.
- Seek and LinkedIn description containers are preferred, with a generic visible-text fallback. Selected-text capture remains available when a page adapter does not find the description.
- Headings and line breaks are retained. Obvious navigation, buttons, scripts, ads, cookie/login prompts, duplicate lines, and zero-width characters are removed. Expand collapsed advert sections before capturing; warnings are shown when likely truncated content is noticed.
- Captures, edits, and settings are stored in `chrome.storage.local`. The extension does not save raw HTML. Duplicate URLs are retained as separate captures with a warning rather than overwriting edits.
- API credentials are only used by extension pages. The extension requests optional, origin-scoped HTTPS host access when the user configures or invokes an API action. Never export or share a settings backup containing tokens.

## Configure the Gemma API

Open **Settings** in the workspace:

- Set the extraction HTTPS base URL (default: `https://localgemma.wanagents.duckdns.org`), bearer token, endpoint paths, timeout, and capability toggles.
- The expected API contract follows `ai-platform_local-llm`: `GET /llm/status`, `POST /llm/wake`, and `POST /extract-job`. The extract request sends `source_url`, `site`, `page_title`, `cleaned_text`, and optional custom prompt fields. The response's extracted fields are validated before they are applied.
- Model selection remains server-managed; this extension does not send a per-request model name.
- Choose server-managed prompt mode or custom override / extra instructions. The LLM receives only the cleaned advert text and small metadata fields—not HTML, browser history, or unrelated jobs.
- Set the maximum input-character warning budget and inactivity timeout. The default timeout is 10 minutes; it stops status monitoring and marks the status stale, but does not cancel an active extraction.
- The single model button checks status, wakes a sleeping model, and polls every four seconds only while warming (with a three-minute cap). It checks once when the workspace opens if refinement is enabled. Refinement requests are serial; timed-out/in-flight work is marked interrupted and is never automatically replayed.

LLM refinement is off by default. Refined fields organize/categorize the job; `description_text` remains the cleaned source of truth and is never overwritten. The server may sleep or be unavailable without affecting local capture and export.

## Direct OpenAI connection

In workspace Settings, choose **OpenAI (direct)**, enter an OpenAI API key and model (default: `gpt-4.1-mini`), enable LLM refinement, and save. Grant Chrome access to `https://api.openai.com` when prompted. The extension sends requests directly to `https://api.openai.com/v1/chat/completions`; no VPS change is needed. Model status/wake controls are unavailable for this provider.

The key is stored locally in `chrome.storage.local`, not encrypted in a credential vault. Use a dedicated project/key with appropriate spending limits; never share the key or commit it. OpenAI API billing is separate from ChatGPT subscriptions. Refinement sends the captured job text to OpenAI and may incur charges. Switching providers clears the credential field, so re-enter the matching key/token before saving.

## Review, export, and inbox

The workspace supports editing source text and metadata, selecting/deleting jobs, and serial refinement. JSON is the preferred batch format and preserves the same compact job envelope for raw and refined captures. CSV properly quotes multiline fields; Markdown is intended for reading. The export settings control default format, filename pattern, save-as behavior, and inclusion of refined arrays. Downloads use Chrome's download API; the extension does not write arbitrary filesystem paths.

Inbox configuration is separate from extraction settings. Sending is explicit and disabled until an HTTPS base URL, path, and enabled setting are configured. The current inbox contract is a JSON POST with `{ "schema_version": 1, "jobs": [...] }`; configure it only for a compatible receiver.

## Validation and manual checks

Automated tests cover text fidelity/cleaning, adapter and selected-text fallback behavior, raw/refined schema consistency, polling/inactivity policy, malformed model output/timeouts, CSV/Markdown serialization, and state migration. `npm run build` syntax-checks the extension JavaScript.

Real Chrome DOM behavior, Seek/LinkedIn markup changes, permission prompts, downloads, and live VPS authentication/network/API compatibility still require manual testing in Chrome. No live endpoint or credential is needed for the automated tests.

## License

Apache License 2.0. See [LICENSE](LICENSE).
