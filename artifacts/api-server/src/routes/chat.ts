import { Router, type IRouter, type Request, type Response } from "express";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

const router: IRouter = Router();

const MAX_MESSAGES = 40;
const MAX_MESSAGE_LENGTH = 20_000;
const GEMINI_MODEL = "gemini-2.5-flash";

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return (
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    message.content.trim().length > 0 &&
    message.content.length <= MAX_MESSAGE_LENGTH
  );
}

function sendEvent(response: Response, payload: Record<string, unknown>) {
  if (!response.writableEnded && !response.destroyed) {
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

/**
 * Gemini's streamGenerateContent endpoint returns SSE events. We translate
 * each provider event into the small, provider-agnostic stream contract the
 * browser consumes: { content } chunks followed by { done: true }.
 */
router.post("/chat", async (req: Request, res: Response) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Gemini is not configured on the server." });
    return;
  }

  const rawMessages = (req.body as { messages?: unknown } | undefined)
    ?.messages;
  if (
    !Array.isArray(rawMessages) ||
    rawMessages.length === 0 ||
    rawMessages.length > MAX_MESSAGES ||
    !rawMessages.every(isChatMessage)
  ) {
    res.status(400).json({
      error: `Send between 1 and ${MAX_MESSAGES} valid messages.`,
    });
    return;
  }

  const abortController = new AbortController();
  let clientDisconnected = false;

  const abortUpstream = () => {
    clientDisconnected = true;
    abortController.abort();
  };

  req.once("aborted", abortUpstream);
  res.once("close", () => {
    if (!res.writableEnded) abortUpstream();
  });

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    const providerResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: "You are an expert AI coding partner. Be concise but helpful. Use markdown for explanations and fenced code blocks for code. When giving code, explain important tradeoffs briefly.",
              },
            ],
          },
          contents: rawMessages.map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }],
          })),
          generationConfig: {
            maxOutputTokens: 8192,
          },
        }),
        signal: abortController.signal,
      },
    );

    if (!providerResponse.ok) {
      const providerError = await providerResponse.text();
      if (!clientDisconnected) {
        sendEvent(res, {
          error: "Gemini could not complete the request.",
          detail:
            process.env.NODE_ENV === "development" ? providerError : undefined,
        });
        res.end();
      }
      return;
    }

    if (!providerResponse.body) {
      if (!clientDisconnected) {
        sendEvent(res, { error: "Gemini returned an empty stream." });
        res.end();
      }
      return;
    }

    const reader = providerResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (!clientDisconnected) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";

      for (const event of events) {
        const dataLine = event
          .split("\n")
          .find((line) => line.startsWith("data:"));
        if (!dataLine) continue;

        try {
          const providerEvent = JSON.parse(dataLine.slice(5).trim()) as {
            candidates?: Array<{
              content?: { parts?: Array<{ text?: string }> };
            }>;
          };
          const content = providerEvent.candidates?.[0]?.content?.parts
            ?.map((part) => part.text ?? "")
            .join("");
          if (content) sendEvent(res, { content });
        } catch {
          // Ignore incomplete/non-JSON provider keep-alive events.
        }
      }
    }

    if (buffer.trim() && !clientDisconnected) {
      const dataLine = buffer
        .split(/\r?\n/)
        .find((line) => line.startsWith("data:"));
      if (dataLine) {
        try {
          const providerEvent = JSON.parse(dataLine.slice(5).trim()) as {
            candidates?: Array<{
              content?: { parts?: Array<{ text?: string }> };
            }>;
          };
          const content = providerEvent.candidates?.[0]?.content?.parts
            ?.map((part) => part.text ?? "")
            .join("");
          if (content) sendEvent(res, { content });
        } catch {
          // Ignore an incomplete final keep-alive event.
        }
      }
    }

    if (!clientDisconnected) {
      sendEvent(res, { done: true });
      res.end();
    }
  } catch (error) {
    if (abortController.signal.aborted || clientDisconnected) return;

    req.log.error({ err: error }, "Gemini chat stream failed");
    sendEvent(res, {
      error: "The connection to Gemini was interrupted. Please try again.",
    });
    res.end();
  } finally {
    req.off("aborted", abortUpstream);
  }
});

export default router;