import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import "../src/capture-core.js";

const { cleanText, extractPage } = globalThis.JobCaptureCore;

class Fixture {
  constructor(text, selectors = {}) { this.innerText = text; this.textContent = text; this.selectors = selectors; }
  cloneNode() { return new Fixture(this.innerText, this.selectors); }
  querySelector(selector) {
    const value = this.selectors[selector];
    return value ? value instanceof Fixture ? value : new Fixture(value) : null;
  }
  querySelectorAll(selector) {
    const value = this.selectors[selector];
    return value ? (Array.isArray(value) ? value : [value]).map((item) => item instanceof Fixture ? item : new Fixture(item)) : [];
  }
}

function fixture(host, selectors, body = "") {
  return {
    title: "Job detail",
    body: new Fixture(body || Object.values(selectors).join("\n")),
    querySelector(selector) {
      const value = selectors[selector];
      const first = Array.isArray(value) ? value[0] : value;
      return first ? first instanceof Fixture ? first : new Fixture(first) : null;
    },
    querySelectorAll(selector) {
      const value = selectors[selector];
      return value ? (Array.isArray(value) ? value : [value]).map((text) => text instanceof Fixture ? text : new Fixture(text)) : [];
    }
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

test("menu, keyboard, and popup capture share saving, feedback, and validation", async (context) => {
  const originalChrome = globalThis.chrome;
  context.after(() => { if (originalChrome === undefined) delete globalThis.chrome; else globalThis.chrome = originalChrome; });
  const listeners = {};
  const menus = [];
  const badges = [];
  const injections = [];
  const tab = { id: 7, url: "https://www.linkedin.com/jobs/view/123" };
  let stored;
  let fail = false;
  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener: (listener) => { listeners.install = listener; } },
      onMessage: { addListener: (listener) => { listeners.message = listener; } }
    },
    contextMenus: {
      removeAll: async () => { menus.length = 0; },
      create: (menu) => menus.push(menu),
      onClicked: { addListener: (listener) => { listeners.menu = listener; } }
    },
    commands: { onCommand: { addListener: (listener) => { listeners.command = listener; } } },
    action: {
      setBadgeText: async (value) => badges.push(value),
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {}
    },
    storage: { local: {
      get: async () => ({ jobCaptureState: structuredClone(stored) }),
      set: async (value) => { stored = structuredClone(value.jobCaptureState); },
      setAccessLevel: async () => {}
    } },
    tabs: {
      query: async () => [tab],
      sendMessage: async (_tabId, message) => fail ? { ok: false, error: "No advert available" } : {
        ok: true,
        captured: { source_url: tab.url, site: "linkedin", title: "Analyst", description_text: message.mode === "selection" ? message.selectionText || "DOM selection" : "Full advert", warnings: ["Transient warning"] }
      }
    },
    scripting: { executeScript: async (value) => injections.push(value) }
  };
  const { captureTab } = await import("../src/background.js");
  await listeners.install();
  assert.deepEqual(menus.map((menu) => menu.id), ["capture-job-page", "capture-job-selection"]);
  assert.equal((await listeners.menu({ menuItemId: "capture-job-page" }, tab)).ok, true);
  assert.equal(stored.jobs.length, 1);
  assert.equal("warnings" in stored.jobs[0], false);
  await listeners.menu({ menuItemId: "capture-job-selection", selectionText: "Context-menu selection" }, tab);
  assert.equal(stored.jobs[0].description_text, "Context-menu selection");
  await listeners.command("capture-job-page", tab);
  const saved = await new Promise((resolve) => listeners.message({ type: "CAPTURE_JOB", mode: "page" }, {}, resolve));
  assert.equal(saved.duplicate, true);
  assert.equal(stored.jobs.length, 4);
  assert.equal(badges.at(-1).text, "OK");
  assert.deepEqual(injections[0], { target: { tabId: tab.id }, files: ["src/capture-core.js", "src/content.js"] });
  await Promise.all([captureTab(tab), captureTab(tab)]);
  assert.equal(stored.jobs.length, 6);
  await assert.rejects(captureTab({ id: 8, url: "chrome://settings" }), /normal browser tab/);
  fail = true;
  assert.equal((await listeners.command("capture-job-page", tab)).ok, false);
  assert.equal(badges.at(-1).text, "!");
  assert.equal(stored.jobs.length, 6);
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.permissions.includes("contextMenus"));
  assert.equal(manifest.commands["capture-job-page"].suggested_key.default, "Alt+Shift+J");
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

test("Seek location prefers the listed city or district over a country-only match", () => {
  for (const city of ["Auckland", "Auckland CBD"]) {
    const doc = fixture("www.seek.co.nz", {
      "[data-automation='job-detail-location']": ["New Zealand", city],
      "[data-automation='jobAdDetails']": "Senior Business Analyst"
    });
    const result = extractPage(doc, new URL("https://www.seek.co.nz/job/123"));
    assert.equal(result.location, city);
  }
  const doc = fixture("www.seek.co.nz", {
    "[data-automation='job-detail-location']": "New Zealand",
    "[itemprop='addressLocality']": "Auckland CBD"
  });
  assert.equal(extractPage(doc, new URL("https://www.seek.co.nz/job/123")).location, "Auckland CBD");
});

test("manual capture retains hard requirements, delivery phases, contract terms, and reference", () => {
  const advert = [
    "Senior Business Analyst via Robert Half",
    "6-month contract, part-time (3-4 days a week)",
    "NZD $115.00 - $125.00 p.h.",
    "Insurance industry experience is a must",
    "System integration and connectivity",
    "SIT (System Integration Testing) and UAT (User Acceptance Testing)",
    "End-to-end workflow validation",
    "Document functional and non-functional requirements",
    "Workshop facilitation and data mapping across platforms",
    "Complex, regulated, multi-entity business models with a national operational footprint",
    "Design sign in workflows and create an account integration",
    "Reference Number: 06900-0013523664"
  ].join("\n");
  const doc = fixture("www.seek.co.nz", { "[data-automation='jobAdDetails']": advert });
  assert.equal(extractPage(doc, new URL("https://www.seek.co.nz/job/123")).description_text, advert);
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

test("LinkedIn public header and labeled criteria provide company, location and employment", () => {
  const header = new Fixture("Senior Business Analyst\nGenesis\nAuckland, Auckland, New Zealand", {
    ".topcard__org-name-link": "Genesis",
    ".topcard__flavor--bullet": "Auckland, Auckland, New Zealand"
  });
  const criterion = new Fixture("Employment type\nFull-time", {
    ".description__job-criteria-subheader": "Employment type",
    ".description__job-criteria-text": "Full-time"
  });
  const doc = fixture("www.linkedin.com", {
    ".top-card-layout": header,
    ".description__job-criteria-item": [criterion],
    ".show-more-less-html__markup": "Data and AI business analysis",
    "[class*='salary']": "NZD $200,000 per year from a recommended job"
  });
  const result = extractPage(doc, new URL("https://www.linkedin.com/jobs/view/4478389067/"));
  assert.equal(result.company, "Genesis");
  assert.equal(result.location, "Auckland, Auckland, New Zealand");
  assert.equal(result.employment_type, "Full-time");
  assert.equal(result.salary_text, null);
});

test("LinkedIn signed-in header captures insight pills and pay without posting activity", () => {
  const header = new Fixture("Senior Business Analyst\nRobert Half\nAuckland CBD · 2 days ago · 29 applicants\nHybrid\nContract\nNZD $115.00 - $125.00 p.h.", {
    ".job-details-jobs-unified-top-card__company-name": "Robert Half",
    ".job-details-jobs-unified-top-card__primary-description-container": "Auckland CBD · 2 days ago · 29 applicants",
    ".job-details-jobs-unified-top-card__job-insight, .jobs-unified-top-card__job-insight": new Fixture("Contract")
  });
  const doc = fixture("www.linkedin.com", { ".job-details-jobs-unified-top-card__container": header, ".jobs-box__html-content": "Insurance experience is a must" });
  const result = extractPage(doc, new URL("https://www.linkedin.com/jobs/view/123/"));
  assert.equal(result.company, "Robert Half");
  assert.equal(result.location, "Auckland CBD");
  assert.equal(result.employment_type, "Contract");
  assert.equal(result.salary_text, "NZD $115.00 - $125.00 p.h.");
});

test("LinkedIn classless header recovers the exported tab-title role and current-job metadata", () => {
  const title = "Senior Business Analyst - Data & AI";
  const description = "In The Moment\nLead discovery across Data & AI initiatives.";
  const doc = fixture("www.linkedin.com", {
    main: ["Navigation", "Genesis", title, "Auckland, Auckland, New Zealand · 2 days ago · 29 people clicked apply", "Responses managed off LinkedIn", "Hybrid", "Full-time", "Apply", "Use AI to assess how you fit", "Premium", "About the job", description, "More jobs", "Other company", "Wellington · 5 days ago", "Contract", "$200,000 per year"].join("\n"),
    ".jobs-box__html-content": description
  });
  doc.title = `${title} | Genesis | LinkedIn`;
  const result = extractPage(doc, new URL("https://www.linkedin.com/jobs/view/4478389067/"));
  assert.equal(result.title, title);
  assert.equal(result.company, "Genesis");
  assert.equal(result.location, "Auckland, Auckland, New Zealand");
  assert.equal(result.employment_type, "Full-time");
  assert.equal(result.salary_text, null);
  assert.equal(result.description_text, description);
});

test("LinkedIn classless fallback never scans recommendations when the job header is absent", () => {
  const title = "Senior Business Analyst - Data & AI";
  const doc = fixture("www.linkedin.com", { main: `About the job\nAdvert text\nMore jobs\nOther company\n${title}\nWellington · 5 days ago\nContract\n$200,000 per year` });
  doc.title = `${title} | Genesis | LinkedIn`;
  const result = extractPage(doc, new URL("https://www.linkedin.com/jobs/view/4478389067/"));
  assert.equal(result.company, "Genesis");
  assert.equal(result.location, null);
  assert.equal(result.employment_type, null);
  assert.equal(result.salary_text, null);
});

test("LinkedIn classless header handles hourly pay and location without posting activity", () => {
  const doc = fixture("www.linkedin.com", {
    main: "Robert Half\nBusiness Analyst\nAuckland CBD, Auckland\nContract\nNZD $115.00 - $125.00 p.h.\nAbout the job\nInsurance experience is a must"
  });
  doc.title = "Business Analyst | Robert Half | LinkedIn";
  const result = extractPage(doc, new URL("https://www.linkedin.com/jobs/view/123/"));
  assert.equal(result.location, "Auckland CBD, Auckland");
  assert.equal(result.employment_type, "Contract");
  assert.equal(result.salary_text, "NZD $115.00 - $125.00 p.h.");
});

test("LinkedIn salary reads explicit compensation or pay in the advert, not benefit amounts", () => {
  const url = new URL("https://www.linkedin.com/jobs/view/123/");
  const doc = fixture("www.linkedin.com", { ".compensation__salary": "$110K/yr - $150K/yr", ".show-more-less-html__markup": "Build systems" });
  assert.equal(extractPage(doc, url).salary_text, "$110K/yr - $150K/yr");
  for (const [description, expected] of [
    ["Salary: NZD $120,000 per year", "Salary: NZD $120,000 per year"],
    ["Annual wellbeing allowance of $1,000", null]
  ]) {
    const doc = fixture("www.linkedin.com", { ".show-more-less-html__markup": description });
    assert.equal(extractPage(doc, url).salary_text, expected);
  }
});

test("LinkedIn prefers the narrow advert over a longer description wrapper", () => {
  const advert = "Lead Data & AI discovery\nDatabricks, Azure or Generative AI would be advantageous";
  for (const selector of [".jobs-description-content__text", ".show-more-less-html__markup", ".description__text"]) {
    const doc = fixture("www.linkedin.com", {
      [selector]: advert,
      ".jobs-description__content": `${advert}\nMore jobs\nOther company\nPromoted\nEasy Apply`
    });
    const result = extractPage(doc, new URL("https://www.linkedin.com/jobs/view/4478389067/"));
    assert.equal(result.description_text, advert);
  }
});

test("LinkedIn broad fallback captures only the Genesis advert and not surrounding UI", () => {
  const advert = [
    "In The Moment, For The Future",
    "What You'll Do",
    "Lead discovery to define business problems, opportunities, outcomes and Data & AI use cases.",
    "Create user stories, acceptance criteria and delivery documentation for Agile or hybrid teams.",
    "Databricks, Azure or Generative AI would be advantageous.",
    "Some Of Our Benefits Include",
    "Southern Cross medical insurance, plus life, trauma and income protection insurances",
    "Everyone's journey is different",
    "We are committed to a fair, accessible, and inclusive recruitment process."
  ].join("\n");
  const pageText = [
    "Genesis", "Senior Business Analyst - Data & AI", "Use AI to assess how you fit",
    "Reactivate Premium", "People you can reach out to", "About the job", advert,
    "Benefits found in job post", "Medical insurance", "Set alert for similar jobs",
    "Job search faster with Premium", "About the company", "38,099 followers",
    "More jobs", "Future Secure AI", "Tower Insurance", "Promoted", "Easy Apply",
    "See more jobs like this", "Looking for talent?", "Post a job"
  ].join("\n");
  const doc = fixture("www.linkedin.com", { main: pageText });
  const result = extractPage(doc, new URL("https://www.linkedin.com/jobs/view/4478389067/"));
  assert.equal(result.description_text, advert);
  assert.match(result.warnings.join(" "), /text boundaries/);
});

test("LinkedIn fallback stops at recommendations and refuses unbounded page text", () => {
  for (const footer of ["More jobs", "About the company", "Set alert for similar jobs", "See more jobs like this"]) {
    const doc = fixture("www.linkedin.com", { main: `Header\nAbout the job\nRequirements\n5 years experience\n${footer}\nOther company` });
    assert.equal(extractPage(doc, new URL("https://www.linkedin.com/jobs/view/1")).description_text, "Requirements\n5 years experience");
  }
  const doc = fixture("www.linkedin.com", { main: "Premium\nMore jobs\nOther company" });
  const url = new URL("https://www.linkedin.com/jobs/view/1");
  const result = extractPage(doc, url);
  assert.equal(result.description_text, "");
  assert.match(result.warnings.join(" "), /Select the advert text/);
  assert.equal(extractPage(doc, url, "Selected advert", "selection").description_text, "Selected advert");
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
