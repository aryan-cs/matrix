import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const DEFAULT_PLANNER_MODEL_ENDPOINT = "";
const DEFAULT_PLANNER_MODEL_ID = "deepseek-r1";
const DEFAULT_PLANNER_PROXY_PATH = "/api/planner/chat";
const DEFAULT_EXA_PROXY_PATH = "/api/exa/search";
const DEFAULT_EXA_API_ENDPOINT = "";

function plannerChatEndpointFor(baseOrEndpoint) {
  const trimmed = (baseOrEndpoint || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.endsWith("/v1/chat/completions")) return trimmed;
  return `${trimmed}/v1/chat/completions`;
}

function previewText(value, limit = 220) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...`;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 5_000_000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function consumeSseDataEvents(buffer, onData) {
  let remaining = buffer;
  while (true) {
    const eventBoundary = remaining.indexOf("\n\n");
    if (eventBoundary === -1) break;

    const eventBlock = remaining.slice(0, eventBoundary);
    remaining = remaining.slice(eventBoundary + 2);

    const lines = eventBlock.split("\n");
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length > 0) {
      onData(dataLines.join("\n"));
    }
  }

  return remaining;
}

function extractStreamDelta(parsedEvent) {
  const choice = parsedEvent?.choices?.[0];
  if (!choice) return "";
  if (typeof choice?.delta?.content === "string") return choice.delta.content;
  if (typeof choice?.delta?.reasoning_content === "string") return choice.delta.reasoning_content;
  if (typeof choice?.text === "string") return choice.text;
  return "";
}

function plannerLoggingProxy(env) {
  const plannerBaseEndpoint =
    env.VITE_PLANNER_MODEL_ENDPOINT ||
    env.VITE_PLANNER_CONTEXT_ENDPOINT ||
    DEFAULT_PLANNER_MODEL_ENDPOINT;
  const plannerModelId = env.VITE_PLANNER_MODEL_ID || DEFAULT_PLANNER_MODEL_ID;
  const plannerApiKey = env.VITE_PLANNER_API_KEY || "";
  const plannerProxyPath =
    env.VITE_PLANNER_PROXY_PATH || env.PLANNER_PROXY_PATH || DEFAULT_PLANNER_PROXY_PATH;

  return {
    name: "planner-logging-proxy",
    configureServer(server) {
      server.middlewares.use(plannerProxyPath, async (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }

        const targetEndpoint = plannerChatEndpointFor(plannerBaseEndpoint);
        if (!targetEndpoint) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Planner endpoint is not configured." }));
          return;
        }

        const requestId = `planner-${Date.now().toString(36)}`;
        const startTime = Date.now();

        let requestBody;
        try {
          requestBody = await readJsonBody(req);
        } catch (error) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: error.message }));
          return;
        }

        const messages = Array.isArray(requestBody?.messages) ? requestBody.messages : [];
        const lastMessage = messages.length > 0 ? messages[messages.length - 1] : {};
        const targetModel = requestBody?.model || plannerModelId;
        const wantsStream = Boolean(requestBody?.stream);

        console.log("");
        console.log("========================================");
        console.log("PLANNER REQUEST");
        console.log(`id: ${requestId}`);
        console.log(`endpoint: ${targetEndpoint}`);
        console.log(`model: ${targetModel}`);
        console.log(`messages: ${messages.length}`);
        console.log(`stream: ${wantsStream}`);
        console.log(`user-preview: ${previewText(lastMessage?.content) || "[empty]"}`);
        console.log("========================================");

        const upstreamPayload = {
          ...requestBody,
          model: targetModel
        };

        let upstreamResponse;
        try {
          upstreamResponse = await fetch(targetEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(plannerApiKey ? { Authorization: `Bearer ${plannerApiKey}` } : {})
            },
            body: JSON.stringify(upstreamPayload)
          });
        } catch (error) {
          console.log("PLANNER RESPONSE");
          console.log(`id: ${requestId}`);
          console.log("status: network_error");
          console.log(`error: ${error.message}`);
          console.log("========================================");

          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: `Upstream request failed: ${error.message}` }));
          return;
        }

        const upstreamContentType = upstreamResponse.headers.get("content-type") || "";
        const canProxyStream =
          wantsStream &&
          upstreamResponse.ok &&
          upstreamResponse.body &&
          upstreamContentType.includes("text/event-stream");

        if (canProxyStream) {
          res.statusCode = upstreamResponse.status;
          res.setHeader("Content-Type", upstreamContentType || "text/event-stream");
          res.setHeader("Cache-Control", upstreamResponse.headers.get("cache-control") || "no-cache");
          res.setHeader("Connection", "keep-alive");
          res.setHeader("X-Accel-Buffering", "no");

          const reader = upstreamResponse.body.getReader();
          const decoder = new TextDecoder("utf-8");
          let sseBuffer = "";
          let chunkCount = 0;
          let assistantAggregate = "";

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunkCount += 1;

              const chunkText = decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
              sseBuffer += chunkText;
              sseBuffer = consumeSseDataEvents(sseBuffer, (payload) => {
                if (!payload || payload === "[DONE]") return;
                let parsed;
                try {
                  parsed = JSON.parse(payload);
                } catch {
                  return;
                }
                const delta = extractStreamDelta(parsed);
                if (delta) {
                  assistantAggregate += delta;
                  return;
                }
                const fullContent = parsed?.choices?.[0]?.message?.content;
                if (typeof fullContent === "string" && fullContent) {
                  assistantAggregate = fullContent;
                }
              });

              res.write(Buffer.from(value));
            }

            const tail = decoder.decode().replace(/\r\n/g, "\n");
            if (tail) {
              sseBuffer += tail;
              sseBuffer = consumeSseDataEvents(sseBuffer, () => {});
              res.write(tail);
            }
            res.end();
          } catch (error) {
            if (!res.writableEnded) {
              res.end();
            }
            console.log("PLANNER RESPONSE");
            console.log(`id: ${requestId}`);
            console.log("status: stream_error");
            console.log(`error: ${error.message}`);
            console.log("========================================");
            return;
          }

          const elapsedMs = Date.now() - startTime;
          console.log("PLANNER RESPONSE");
          console.log(`id: ${requestId}`);
          console.log(`status: ${upstreamResponse.status}`);
          console.log(`duration_ms: ${elapsedMs}`);
          console.log("mode: stream");
          console.log(`chunks: ${chunkCount}`);
          console.log(`assistant-preview: ${previewText(assistantAggregate) || "[empty]"}`);
          console.log("========================================");
          return;
        }

        let upstreamText = "";
        try {
          upstreamText = await upstreamResponse.text();
        } catch {
          upstreamText = "";
        }

        let parsed;
        try {
          parsed = JSON.parse(upstreamText);
        } catch {
          parsed = null;
        }

        const elapsedMs = Date.now() - startTime;
        const completionPreview = parsed?.choices?.[0]?.message?.content
          ? previewText(parsed.choices[0].message.content)
          : previewText(upstreamText);

        console.log("PLANNER RESPONSE");
        console.log(`id: ${requestId}`);
        console.log(`status: ${upstreamResponse.status}`);
        console.log(`duration_ms: ${elapsedMs}`);
        console.log(`mode: ${wantsStream ? "non_stream_fallback" : "non_stream"}`);
        console.log(`assistant-preview: ${completionPreview || "[empty]"}`);
        console.log("========================================");

        res.statusCode = upstreamResponse.status;
        res.setHeader("Content-Type", upstreamResponse.headers.get("content-type") || "application/json");
        res.end(upstreamText);
      });
    }
  };
}

function exaProxy(env) {
  const exaApiKey = env.EXA_API_KEY || "";
  const exaProxyPath = env.VITE_EXA_PROXY_PATH || env.EXA_PROXY_PATH || DEFAULT_EXA_PROXY_PATH;
  const exaApiEndpoint = env.EXA_API_ENDPOINT || DEFAULT_EXA_API_ENDPOINT;

  return {
    name: "exa-proxy",
    configureServer(server) {
      server.middlewares.use(exaProxyPath, async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method Not Allowed");
          return;
        }

        if (!exaApiEndpoint) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "EXA_API_ENDPOINT is not configured." }));
          return;
        }

        let body;
        try {
          body = await readJsonBody(req);
        } catch (error) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: error.message }));
          return;
        }

        let upstream;
        try {
          upstream = await fetch(exaApiEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": exaApiKey
            },
            body: JSON.stringify(body)
          });
        } catch (error) {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: `Exa request failed: ${error.message}` }));
          return;
        }

        const text = await upstream.text();
        res.statusCode = upstream.status;
        res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
        res.end(text);
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, path.resolve(process.cwd(), ".."), ""),
    ...loadEnv(mode, process.cwd(), "")
  };

  return {
    plugins: [react(), plannerLoggingProxy(env), exaProxy(env)],
    server: {
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8000",
          changeOrigin: true
        }
      }
    }
  };
});
