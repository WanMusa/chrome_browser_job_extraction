export function parseRefinement(data) {
  let result = data;
  if (typeof data === "string") {
    try { result = JSON.parse(data); }
    catch { throw new Error("Extractor returned malformed refinement JSON; original capture was kept."); }
  }
  if (result && typeof result.raw_model_output === "string" && (!Array.isArray(result.requirements) || (!result.title && !result.skills?.length))) {
    try { result = { ...result, ...JSON.parse(result.raw_model_output) }; }
    catch { throw new Error("Extractor returned malformed refinement JSON; original capture was kept."); }
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Extractor returned an invalid response; original capture was kept.");
  const array = (key) => {
    const value = result[key];
    if (value == null) return [];
    if (Array.isArray(value) && value.every((part) => typeof part === "string")) return value;
    throw new Error(`Extractor returned invalid ${key}; original capture was kept.`);
  };
  return {
    title: typeof result.title === "string" ? result.title : null,
    company: typeof result.company === "string" ? result.company : null,
    location: typeof result.location === "string" ? result.location : null,
    salary_text: typeof result.salary_text === "string" ? result.salary_text : null,
    employment_type: typeof result.employment_type === "string" ? result.employment_type : null,
    requirements: array("requirements"),
    responsibilities: array("responsibilities"),
    skills: array("skills"),
    notes: typeof result.notes === "string" ? result.notes : null
  };
}

export function refinementFailure(error) {
  return error?.name === "TimeoutError" || error?.name === "AbortError"
    ? { state: "interrupted", warning: "Refinement timed out; retry manually. The server may have completed the request." }
    : { state: "failed", warning: error?.message || "Refinement failed; original capture is unchanged." };
}
