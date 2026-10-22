export const JOB_RUNS_PATH = "/resume/job-runs";

function apiRoot(baseUrl) {
  const base = baseUrl.trim();
  let origin;
  try {
    const parsed = new URL(base);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error();
    }
    origin = parsed.origin;
  } catch {
    throw new Error("Configure a valid HTTPS Job Runs API base URL in Settings.");
  }
  return new URL(JOB_RUNS_PATH, `${origin}/`);
}

function jobRunUrl(config, suffix = "") {
  if (!config.token?.trim()) throw new Error("Configure the separate Job Runs API token in Settings.");
  return new URL(`${JOB_RUNS_PATH}${suffix}`, `${apiRoot(config.baseUrl).origin}/`).href;
}

async function request(fetcher, config, suffix, options = {}) {
  const response = await fetcher(jobRunUrl(config, suffix), {
    ...options,
    headers: { Authorization: `Bearer ${config.token.trim()}`, ...options.headers },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Job Runs request failed (${response.status}).`);
  return response.status === 204 ? null : response.json();
}

export function fetchJobRuns(fetcher, config) {
  return request(fetcher, config, "");
}

export function retryJobRun(fetcher, config, id) {
  return request(fetcher, config, `/${encodeURIComponent(id)}/retry`, { method: "POST" });
}

export function regenerateJobRun(fetcher, config, id) {
  return request(fetcher, config,
    `/${encodeURIComponent(id)}/regenerate?confirm_paid_generation=true`, { method: "POST" });
}

export async function fetchResumeUrl(fetcher, config, id) {
  const result = await request(fetcher, config, `/${encodeURIComponent(id)}/resume-url`);
  if (!result || typeof result.url !== "string" || !Number.isFinite(result.expires_in)) {
    throw new Error("The API returned an invalid resume download link.");
  }
  const signed = new URL(result.url);
  if (signed.protocol !== "https:") throw new Error("The resume download link is not HTTPS.");
  return result;
}

export async function fetchCoverLetterUrl(fetcher, config, id) {
  const result = await request(fetcher, config, `/${encodeURIComponent(id)}/cover-letter-url`);
  if (!result || typeof result.url !== "string" || !Number.isFinite(result.expires_in)) {
    throw new Error("The API returned an invalid cover letter download link.");
  }
  const signed = new URL(result.url);
  if (signed.protocol !== "https:") throw new Error("The cover letter download link is not HTTPS.");
  return result;
}
