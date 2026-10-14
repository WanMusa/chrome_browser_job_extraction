(() => {
const NOISE = /^(?:skip to content|sign in|log in|create an account|cookie preferences|related jobs|similar jobs|advertise with us|report this job|job alert)[.!:\s]*$/i;
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

function cleanText(text) {
  return String(text || "")
    .replace(ZERO_WIDTH, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, index, all) => line && !NOISE.test(line) && (line !== all[index - 1]))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textOf(element) {
  if (!element) return "";
  const clone = element.cloneNode(true);
  clone.querySelectorAll([
    "script", "style", "noscript", "svg", "iframe", "nav", "footer", "button",
    "[aria-hidden='true']", "[hidden]", "[role='navigation']", "[role='button']",
    ".cookie-banner", ".cookie-consent", ".advertisement", ".related-jobs", ".similar-jobs",
    "[data-ad-slot]", "[data-ad-client]", "[id^='ad-']"
  ].join(",")).forEach((node) => node.remove());
  clone.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  clone.querySelectorAll("p, div, section, article, h1, h2, h3, h4, h5, h6, li, tr").forEach((node) => node.append("\n"));
  return cleanText(clone.innerText || clone.textContent || "");
}

function firstText(root, selectors) {
  for (const selector of selectors) {
    const found = root.querySelector(selector);
    const value = textOf(found);
    if (value) return value;
  }
  return null;
}

function canonicalUrl(url) {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|tracking|trk|ref|lipi)/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hash = "";
    return parsed.href;
  } catch {
    return url || "";
  }
}

function listedLocation(document) {
  const selectors = [
    "[data-automation='job-detail-location']", "[data-automation='jobLocation']",
    "[data-testid='job-location']", "[itemprop='addressLocality']", "[itemprop='jobLocation']",
    ".job-details-jobs-unified-top-card__primary-description-container .tvm__text--low-emphasis",
    ".job-details-jobs-unified-top-card__primary-description-container",
    ".jobs-unified-top-card__bullet", ".jobs-unified-top-card__primary-description", ".topcard__flavor--bullet"
  ];
  let country = null;
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      const value = textOf(element);
      if (!value) continue;
      if (/^(?:New Zealand|Australia|United Kingdom|United States|Singapore)$/i.test(value)) {
        country ||= value;
      } else {
        return value;
      }
    }
  }
  return country;
}

function linkedInMetadata(document, description) {
  const header = document.querySelector(".job-details-jobs-unified-top-card__container")
    || document.querySelector(".jobs-unified-top-card")
    || document.querySelector(".top-card-layout");
  const root = header || document;
  const company = firstText(root, [
    ".job-details-jobs-unified-top-card__company-name", ".jobs-unified-top-card__company-name",
    ".topcard__org-name-link", "[itemprop='hiringOrganization']"
  ]);
  const location = listedLocation(root)?.split(/\s*(?:\u00b7|\n)\s*/)[0].trim() || null;
  const headerLines = header ? cleanText(header.innerText || header.textContent).split("\n") : [];
  let employment = null;
  for (const item of document.querySelectorAll(".description__job-criteria-item")) {
    const label = firstText(item, [".description__job-criteria-subheader", "h3"]);
    if (/^Employment type$/i.test(label || "")) {
      employment = firstText(item, [".description__job-criteria-text"]);
      break;
    }
  }
  if (!employment) {
    const insights = [...root.querySelectorAll(".job-details-jobs-unified-top-card__job-insight, .jobs-unified-top-card__job-insight")]
      .flatMap((item) => cleanText(item.innerText || item.textContent).split("\n"));
    employment = [...insights, ...headerLines].find((line) => /^(?:Full-time|Part-time|Contract|Temporary|Internship|Volunteer|Other)$/i.test(line)) || null;
  }
  const hasMoney = /(?:\b(?:NZD|USD|AUD|CAD|GBP|EUR)\b|(?:NZ|US|AU|CA)?\$|\u00a3|\u20ac)\s*\d/i;
  const hasPayPeriod = /(?:\/(?:hr|hour|yr|year|mo|month|annum)\b|\bper\s+(?:hour|year|month|annum)\b|\bp\.?[ah]\.?\b|\bsalary\b|\bbase pay\b|\bpay range\b)/i;
  const salary = firstText(root, [".job-details-jobs-unified-top-card__salary", ".jobs-unified-top-card__salary"])
    || firstText(document, [".compensation__salary"])
    || [...headerLines, ...cleanText(description).split("\n")].find((line) => hasMoney.test(line) && hasPayPeriod.test(line))
    || null;
  return { company, location, employment, salary };
}

function linkedInFallback(text) {
  const lines = cleanText(text).split("\n");
  const start = lines.findIndex((line) => /^About (?:the|this) job$/i.test(line));
  if (start < 0) return "";
  const ending = /^(?:Benefits found in job post|Set alert for similar jobs|Job search faster with Premium|About the company|More jobs|See more jobs like this|Looking for talent\??|Seniority level|Employment type|Job function|Industries)$/i;
  const end = lines.findIndex((line, index) => index > start && ending.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

function extractPage(document, location, selectionText = "", mode = "page") {
  const host = location.hostname.toLowerCase();
  const isSeek = /(^|\.)seek\.(com\.au|co\.nz|co\.uk|com)$/.test(host);
  const isLinkedIn = host === "linkedin.com" || host.endsWith(".linkedin.com");
  const site = isSeek ? "seek" : isLinkedIn ? "linkedin" : "other";
  const descriptionSelectors = site === "seek"
    ? ["[data-automation='jobAdDetails']", "[data-automation='jobDescription']", "[data-testid*='job-description']"]
    : site === "linkedin"
      ? [".jobs-description-content__text", "[class*='jobs-description-content__text']", ".jobs-box__html-content", ".show-more-less-html__markup", ".description__text", ".jobs-description__content"]
      : ["[itemprop='description']", "article", "main"];
  let description = "";
  for (const selector of descriptionSelectors) {
    const candidate = document.querySelector(selector);
    const text = textOf(candidate);
    if (text.length > description.length) description = text;
    if (site === "linkedin" && description) break;
  }
  let warnings = [];
  if (mode === "selection") {
    if (selectionText.trim()) {
      description = cleanText(selectionText);
      warnings.push("Captured selected text only; confirm it contains the complete job advert.");
    } else {
      description = "";
      warnings.push("No text was selected. Select the advert text and capture again.");
    }
  } else if (!description && selectionText.trim()) {
    description = cleanText(selectionText);
    warnings.push("Captured selected text because a job description container was not found.");
  } else if (!description) {
    const pageText = textOf(document.querySelector("main")) || textOf(document.body);
    if (site === "linkedin") {
      description = linkedInFallback(pageText);
      warnings.push(description
        ? "Captured LinkedIn's About the job section using text boundaries; review it for completeness."
        : "Could not isolate LinkedIn's job description. Select the advert text and capture the selection instead.");
    } else {
      description = pageText;
      warnings.push("Used broad page text; review the captured description for unrelated content.");
    }
  }

  const bodyText = textOf(document.body);
  if (/see more|show more|view more|read more/i.test(bodyText.slice(0, 12000))) {
    warnings.push("The advert may be collapsed or truncated. Expand the full description and capture again.");
  }
  if (description.length > 30000) warnings.push("Description exceeds the configured default input budget; review before refinement.");

  const title = firstText(document, [
    "[data-automation='jobTitle']", "[data-testid*='job-title']",
    ".jobs-unified-top-card__job-title", "h1"
  ]);
  const linkedIn = site === "linkedin" ? linkedInMetadata(document, description) : null;
  const company = linkedIn ? linkedIn.company : firstText(document, [
    "[data-automation='advertiser-name']", "[data-testid*='company']",
    ".jobs-unified-top-card__company-name", "[itemprop='hiringOrganization']"
  ]);
  const locationText = linkedIn ? linkedIn.location : listedLocation(document);
  const salary = linkedIn ? linkedIn.salary : firstText(document, [
    "[data-automation='job-detail-salary']", "[class*='salary']"
  ]);
  const employment = linkedIn ? linkedIn.employment : firstText(document, [
    "[data-automation='job-detail-work-type']", "[class*='employment-type']"
  ]);

  return {
    source_url: canonicalUrl(location.href),
    site,
    title: title || document.title || null,
    company,
    location: locationText,
    description_text: cleanText(description),
    employment_type: employment,
    salary_text: salary,
    warnings
  };
}

globalThis.JobCaptureCore = { cleanText, extractPage };
})();
