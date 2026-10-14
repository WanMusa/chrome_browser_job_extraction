# Local Job Capture

A Manifest V3 Chrome extension for capturing Seek, LinkedIn, and other job adverts into a local review basket. Capture, editing, and export work offline and do not use an LLM.

## Install and develop

1. Install Node.js 20 or newer, then run `npm test` and `npm run build` in this repository.
2. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`.
3. After source updates, click **Reload** on the extension and refresh job tabs. The extension loads directly from source; `npm run build` performs syntax checks, not packaging.

## Capture

- Right-click a job page and choose **Capture job page**.
- Select the advert text, right-click, and choose **Capture selected job text**.
- Press **Alt+Shift+J** to capture the current page without opening the popup. Chrome may leave a shortcut unassigned if it conflicts with another extension or OS shortcut. Customize it at `chrome://extensions/shortcuts`; a separate selection-capture command can also be assigned there.
- The popup still offers page capture, selection capture, and **Open workspace**.

The extension icon shows `OK` after a successful capture or `!` after a failure. Hover over the icon for the result or error. Captures made by menu/shortcut appear in an already-open workspace automatically. Duplicate URLs are kept as separate captures rather than overwriting edited jobs. No floating buttons are injected into websites.

Expand the full advert before capturing. Seek and LinkedIn description containers are preferred. LinkedIn selects the narrow advert instead of a longer page wrapper; fallback isolates `About the job` and stops before recommendation, company, and Premium UI sections. If it cannot isolate the advert, select the text and use selection capture. Other sites retain a generic visible-text fallback.

Headings, paragraph/list boundaries, hard requirements, reference numbers, and numeric thresholds are retained without summarizing. Cleanup targets known ad containers and standalone navigation text, not arbitrary class names containing `advert` or `ads`. City/district location matches take precedence over country-only matches when available.

## Review and schema

The workspace lets you edit title, company, location, employment type, salary, and the job description; select jobs; export; and delete captures. There are no model connection, refinement, or structured requirement/skills panels.

Saved and exported job records use schema version **2**, with these fields only:

```json
{
  "id": "generated-id",
  "source_url": "https://www.linkedin.com/jobs/view/123/",
  "site": "linkedin",
  "captured_at": "2026-10-15T12:00:00.000Z",
  "title": "Business Analyst",
  "company": "Genesis",
  "location": "Auckland CBD",
  "description_text": "Full captured advert text",
  "employment_type": "Full-time",
  "salary_text": null
}
```

Existing storage migrates automatically, preserving source text and metadata while dropping extraction mode, requirements, responsibilities, skills, notes, warnings, operation state, and old LLM settings/credentials. Those removed fields are not retained in a backup; export an old version first if you need them. Existing captures are not re-scraped: re-capture an advert to recover text omitted by an older scraper.

## Export

JSON exports create **one file per job**, including when using **Export selected** or **Export all**. Each file retains the envelope `{ "schema_version": 2, "exported_at": "...", "jobs": [...] }` with one job.

Names use the local export date in **MMDDYYYY**, whitespace-free role name, lowercase company, and source:

```text
10152026-BusinessAnalyst-genesis-linkedin.json
```

Unsafe filename characters are removed and missing metadata uses `UntitledRole`, `unknown`, and `other`. Chrome adds a suffix when a filename already exists, rather than overwriting it. Choose whether to ask for a save location in Settings; multiple JSON jobs produce multiple save prompts when enabled.

CSV and Markdown remain batch exports. A single-job file uses the same descriptive naming; multiple-job batches use names such as `10152026-jobs-3.csv`. All formats omit the removed fields.

## Inbox and privacy

An optional HTTPS JSON POST inbox can be configured in Settings for a future resume generator. It receives `{ "schema_version": 2, "jobs": [...] }` only after you explicitly select **Send selected**. Sending stays disabled until configured and enabled. Endpoint paths must remain on the configured origin, and Chrome requests optional host access when needed.

Capture reads the current page's text; it does not fetch job URLs or save raw HTML. Jobs and settings stay in `chrome.storage.local`. Storage access is restricted to trusted extension contexts. Inbox bearer tokens are local settings, not encrypted-vault credentials; never share them or commit them.

## Validation

`npm test` covers capture fidelity, scoped LinkedIn fallback, location matching, repeated script injection, menu/keyboard/popup routing, capture errors and queued saves, schema migration, export fields, and filename safety. `npm run build` checks JavaScript syntax. Chrome's native context menus, OS shortcut conflicts, real download prompts, and current website markup still require manual verification in Chrome.

## License

Apache License 2.0. See [LICENSE](LICENSE).