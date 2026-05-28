interface GuardrailsCompletionRequest {
  model: string;
  messages: any;
  guardrails?: string[];
  tools?: any[];
  tool_choice?: string;
}

// handle guardrails requests
export async function makeGuardrailsRequest(
  requestBody: GuardrailsCompletionRequest,
): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const response = await fetch(`${baseURL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}
