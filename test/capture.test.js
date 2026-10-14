import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import "../src/capture-core.js";

const { cleanText, extractPage } = globalThis.JobCaptureCore;

class Fixture {
  constructor(text) { this.innerText = text; this.textContent = text; }
  cloneNode() { return new Fixture(this.innerText); }
  querySelectorAll() { return []; }
}

function fixture(host, selectors, body = "") {
  return {
    title: "Job detail",
    body: new Fixture(body || Object.values(selectors).join("\n")),
    querySelector(selector) { return selectors[selector] ? new Fixture(selectors[selector]) : null; }
  };
}

test("classic script injection supports page and selection capture repeatedly", () => {
  const coreSource = readFileSync(new URL("../src/capture-core.js", import.meta.url), "utf8");
  const contentSource = readFileSync(new URL("../src/content.js", import.meta.url), "utf8");
  const listeners = [];
  const context = createContext({
    URL,
    document: fixture("example.com", { article: "Requirements\n5 years of Python experience", h1: "Engineer" }),
    location: new URL("https://example.com/jobs/1"),
    window: { getSelection: () => ({ toString: () => "Selected advert\n10 years experience" }) },
    chrome: { runtime: { onMessage: { addListener: (listener) => listeners.push(listener) } } }
  });
  for (const mode of ["page", "selection", "page"]) {
    runInContext(coreSource, context);
    runInContext(contentSource, context);
    assert.equal(listeners.length, 1);
    let response;
    listeners[0]({ type: "CAPTURE_VISIBLE_PAGE", mode }, {}, (value) => { response = value; });
    assert.equal(response.ok, true, response.error);
    assert.equal(response.captured.description_text, mode === "selection"
      ? "Selected advert\n10 years experience"
      : "Requirements\n5 years of Python experience");
    assert.equal(response.captured.title, "Engineer");
  }
});

test("cleaning removes clutter without summarizing requirements or thresholds", () => {
  const text = cleanText("Requirements\n5+ years of experience\nBachelor’s degree required\nSign in\nPython and SQL\nPython and SQL\n");
  assert.equal(text, "Requirements\n5+ years of experience\nBachelor’s degree required\nPython and SQL");
});

test("Seek adapter preserves advert source text and canonical listing URL", () => {
  const doc = fixture("www.seek.com.au", {
    "[data-automation='jobAdDetails']": "Responsibilities\nBuild reliable systems\nRequirements\nAt least 5 years of Python experience",
    "[data-automation='jobTitle']": "Senior Engineer",
    "[data-automation='advertiser-name']": "Example Ltd",
    "[data-automation='job-detail-location']": "Sydney"
  });
  const result = extractPage(doc, new URL("https://www.seek.com.au/job/123?tracking=ad"), "");
  assert.equal(result.site, "seek");
  assert.equal(result.source_url, "https://www.seek.com.au/job/123");
  assert.equal(result.title, "Senior Engineer");
  assert.match(result.description_text, /At least 5 years of Python experience/);
});

test("LinkedIn adapter preserves meaningful job id and selected-text fallback", () => {
  const doc = fixture("www.linkedin.com", {
    ".jobs-description__content": "Platform Engineer\nRequired: 7 years operating distributed systems",
    ".jobs-unified-top-card__job-title": "Platform Engineer"
  });
  const result = extractPage(doc, new URL("https://www.linkedin.com/jobs/view/55?currentJobId=55&trk=public_jobs"), "");
  assert.equal(result.site, "linkedin");
  assert.match(result.source_url, /currentJobId=55/);
  assert.doesNotMatch(result.source_url, /trk=/);
  assert.match(result.description_text, /7 years operating distributed systems/);
});

test("selected text is used when adapters have no job description", () => {
  const doc = fixture("example.com", { h1: "Job" }, "header");
  const result = extractPage(doc, new URL("https://example.com/jobs/1"), "Required\n10 years experience", "page");
  assert.equal(result.description_text, "Required\n10 years experience");
  assert.match(result.warnings.join(" "), /selected text/);
});

test("explicit selection capture does not silently substitute the full page", () => {
  const doc = fixture("example.com", { article: "Full job description" });
  const result = extractPage(doc, new URL("https://example.com/jobs/1"), "", "selection");
  assert.equal(result.description_text, "");
  assert.match(result.warnings.join(" "), /No text was selected/);
});
