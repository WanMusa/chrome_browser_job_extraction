(() => {
const NOISE = /\b(?:skip to content|sign in|log in|create an account|cookie preferences|related jobs|similar jobs|advertise with us|report this job|job alert)\b/i;
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
    "[class*='cookie' i]", "[class*='advert' i]", "[class*='related' i]",
    "[class*='login' i]", "[class*='modal' i]", "[class*='promo' i]",
    "[class*='ads' i]", "[id*='ad-' i]"
  ].join(",")).forEach((node) => node.remove());
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

function extractPage(document, location, selectionText = "", mode = "page") {
  const host = location.hostname.toLowerCase();
  const isSeek = /(^|\.)seek\.(com\.au|co\.nz|co\.uk|com)$/.test(host);
  const isLinkedIn = host === "linkedin.com" || host.endsWith(".linkedin.com");
  const site = isSeek ? "seek" : isLinkedIn ? "linkedin" : "other";
  const descriptionSelectors = site === "seek"
    ? ["[data-automation='jobAdDetails']", "[data-automation='jobDescription']", "[data-testid*='job-description']"]
    : site === "linkedin"
      ? [".jobs-description__content", ".jobs-box__html-content", "[class*='jobs-description-content__text']"]
      : ["[itemprop='description']", "article", "main"];
  let description = "";
  for (const selector of descriptionSelectors) {
    const candidate = document.querySelector(selector);
    const text = textOf(candidate);
    if (text.length > description.length) description = text;
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
    description = textOf(document.querySelector("main")) || textOf(document.body);
    warnings.push("Used broad page text; review the captured description for unrelated content.");
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
  const company = firstText(document, [
    "[data-automation='advertiser-name']", "[data-testid*='company']",
    ".jobs-unified-top-card__company-name", "[itemprop='hiringOrganization']"
  ]);
  const locationText = firstText(document, [
    "[data-automation='job-detail-location']", ".jobs-unified-top-card__primary-description"
  ]);
  const salary = firstText(document, [
    "[data-automation='job-detail-salary']", "[class*='salary']"
  ]);
  const employment = firstText(document, [
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
