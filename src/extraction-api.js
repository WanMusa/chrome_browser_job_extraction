export function buildExtractRequest(job, profile) {
  return {
    source_url: job.source_url || null,
    site: job.site,
    page_title: job.title,
    cleaned_text: job.description_text,
    ...(profile.promptMode === "custom" && profile.systemPrompt ? { system_prompt_override: profile.systemPrompt } : {}),
    ...(profile.promptMode === "custom" && profile.extraInstructions ? { extra_instructions: profile.extraInstructions } : {})
  };
}

export async function requestRefinement(fetcher, url, profile, job) {
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(profile.token ? { Authorization: "Bearer " + profile.token } : {})
    },
    body: JSON.stringify(buildExtractRequest(job, profile)),
    signal: AbortSignal.timeout(profile.timeoutSeconds * 1000)
  });
  if (!response.ok) throw new Error(`Extraction failed (${response.status}); original capture is unchanged.`);
  return response.json();
}
