const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;

function loadLocalEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const separator = trimmed.indexOf("=");
    if (separator === -1) return;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

loadLocalEnv();

const PORT = Number(process.env.PORT || 3000);
const AI_PROVIDER = (process.env.AI_PROVIDER || (process.env.ARK_API_KEY ? "ark" : "openai")).toLowerCase();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const OPENAI_IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE || "1024x1536";

const ARK_API_KEY = process.env.ARK_API_KEY || "";
const ARK_BASE_URL = process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
const ARK_IMAGE_MODEL = process.env.ARK_IMAGE_MODEL || "doubao-seedream-5-0-260128";
const ARK_IMAGE_SIZE = process.env.ARK_IMAGE_SIZE || "2K";
const ARK_WATERMARK = String(process.env.ARK_WATERMARK || "false").toLowerCase() === "true";

const MAX_BODY_BYTES = 70 * 1024 * 1024;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf"
};

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

function createApiError(message, status = 500, code = "server_error", hint = "") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.hint = hint;
  return error;
}

function explainProviderError(provider, error, status) {
  const code = error?.code || error?.type || error?.error?.code || `${provider}_error`;
  const message = error?.message || error?.error?.message || error?.msg || "AI image generation failed.";
  const lower = `${code} ${message}`.toLowerCase();

  if (lower.includes("quota") || lower.includes("billing") || lower.includes("balance")) {
    return createApiError(
      "API balance or quota is insufficient.",
      status || 402,
      code,
      provider === "ark"
        ? "Check Volcengine billing, model activation, and remaining balance."
        : "ChatGPT Plus does not include API credits. Check OpenAI Platform Billing / Usage."
    );
  }

  if (lower.includes("api key") || lower.includes("apikey") || lower.includes("unauthorized") || lower.includes("forbidden")) {
    return createApiError(
      "API key is invalid or not configured.",
      status || 401,
      code,
      provider === "ark"
        ? "Check Render environment variable ARK_API_KEY, then redeploy."
        : "Check Render environment variable OPENAI_API_KEY, then redeploy."
    );
  }

  if (lower.includes("model") && (lower.includes("not found") || lower.includes("does not exist") || lower.includes("unsupported"))) {
    return createApiError(
      "The selected image model is unavailable.",
      status || 400,
      code,
      provider === "ark"
        ? "Check ARK_IMAGE_MODEL. The model from your screenshot is doubao-seedream-5-0-260128."
        : "Try OPENAI_IMAGE_MODEL=gpt-image-1 first."
    );
  }

  if (lower.includes("image") || lower.includes("size") || lower.includes("too large") || lower.includes("format")) {
    return createApiError(
      "The uploaded image or output size is not accepted by the provider.",
      status || 400,
      code,
      provider === "ark"
        ? "Try fewer/smaller images. If multi-image fails, test with one image first. ARK_IMAGE_SIZE can be 2K."
        : "Try fewer/smaller images or OPENAI_IMAGE_SIZE=1024x1536."
    );
  }

  return createApiError(message, status || 500, code, "Check Render Logs for the full provider response.");
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(createApiError("Request body is too large.", 413, "body_too_large", "Upload fewer or smaller images."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(raw || "{}"));
      } catch (error) {
        reject(createApiError("Invalid JSON request.", 400, "invalid_json", "Please refresh and try again."));
      }
    });

    req.on("error", reject);
  });
}

function dataUrlToBlob(dataUrl, index) {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i.exec(dataUrl || "");
  if (!match) {
    throw createApiError("Unsupported image format.", 400, "unsupported_image", "Please upload JPG, PNG, or WEBP.");
  }

  const mime = match[1].replace("image/jpg", "image/jpeg");
  const extension = mime.split("/")[1].replace("jpeg", "jpg");
  const buffer = Buffer.from(match[2], "base64");
  return {
    blob: new Blob([buffer], { type: mime }),
    filename: `reference-${index + 1}.${extension}`
  };
}

async function imageUrlToDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw createApiError(
      "The provider returned an image URL, but the server could not download it.",
      response.status,
      "image_download_failed",
      "Try generating again, or check whether the image URL from the provider has expired."
    );
  }

  const contentType = response.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

async function callOpenAiImageEdit({ prompt, images }) {
  if (!OPENAI_API_KEY) {
    throw createApiError("OPENAI_API_KEY is not configured.", 500, "missing_openai_key", "Add OPENAI_API_KEY in Render.");
  }

  const form = new FormData();
  form.append("model", OPENAI_IMAGE_MODEL);
  form.append("prompt", prompt);
  form.append("size", OPENAI_IMAGE_SIZE);
  form.append("output_format", "png");
  form.append("quality", "high");

  images.slice(0, 6).forEach((dataUrl, index) => {
    const image = dataUrlToBlob(dataUrl, index);
    form.append("image", image.blob, image.filename);
  });

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: form
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw explainProviderError("openai", result.error || result, response.status);
  }

  const imageBase64 = result.data?.[0]?.b64_json;
  if (!imageBase64) {
    throw createApiError("OpenAI did not return image data.", 502, "missing_image_data", "Check Render Logs.");
  }

  return `data:image/png;base64,${imageBase64}`;
}

async function callArkImageGenerate({ prompt, images }) {
  if (!ARK_API_KEY) {
    throw createApiError("ARK_API_KEY is not configured.", 500, "missing_ark_key", "Add ARK_API_KEY in Render.");
  }

  const endpoint = `${ARK_BASE_URL.replace(/\/$/, "")}/images/generations`;
  const imageInput = images.length === 1 ? images[0] : images.slice(0, 6);
  const body = {
    model: ARK_IMAGE_MODEL,
    prompt,
    size: ARK_IMAGE_SIZE,
    response_format: "url",
    extra_body: {
      image: imageInput,
      watermark: ARK_WATERMARK
    }
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ARK_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw explainProviderError("ark", result.error || result, response.status);
  }

  const imageUrl = result.data?.[0]?.url || result.data?.[0]?.image_url || result.url;
  const imageBase64 = result.data?.[0]?.b64_json;
  if (imageBase64) {
    return `data:image/png;base64,${imageBase64}`;
  }
  if (imageUrl) {
    return imageUrlToDataUrl(imageUrl);
  }

  throw createApiError("Ark did not return an image URL.", 502, "missing_image_url", "Check Render Logs.");
}

async function generateImage({ prompt, images }) {
  if (AI_PROVIDER === "ark" || AI_PROVIDER === "volcengine") {
    return callArkImageGenerate({ prompt, images });
  }
  if (AI_PROVIDER === "openai") {
    return callOpenAiImageEdit({ prompt, images });
  }

  throw createApiError(
    `Unknown AI_PROVIDER: ${AI_PROVIDER}`,
    500,
    "unknown_provider",
    "Use AI_PROVIDER=ark or AI_PROVIDER=openai."
  );
}

async function handleGenerateCover(req, res) {
  try {
    console.log(`[generate-cover] request started provider=${AI_PROVIDER}`);
    const body = await readJsonBody(req);
    const prompt = String(body.prompt || "").trim();
    const images = Array.isArray(body.images) ? body.images : [];
    console.log(`[generate-cover] body received images=${images.length} promptLength=${prompt.length}`);

    if (!prompt) {
      sendJson(res, 400, {
        error: "Missing prompt.",
        code: "missing_prompt",
        hint: "Enter a title and choose a style first."
      });
      return;
    }
    if (!images.length) {
      sendJson(res, 400, {
        error: "Please upload at least one reference image.",
        code: "missing_image",
        hint: "Upload an image before clicking AI 完整出图."
      });
      return;
    }

    const image = await generateImage({ prompt, images });
    sendJson(res, 200, { image, provider: AI_PROVIDER });
  } catch (error) {
    console.error("[generate-cover]", error);
    sendJson(res, error.status || 500, {
      error: error.message || "Server generation failed.",
      code: error.code || "server_error",
      hint: error.hint || "Check Render Logs for details."
    });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(ROOT, requestedPath));

  if (!filePath.startsWith(ROOT)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, "Not found");
      return;
    }

    const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/generate-cover") {
    handleGenerateCover(req, res);
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  send(res, 405, "Method not allowed");
});

server.listen(PORT, () => {
  console.log(`XHS cover generator running at http://localhost:${PORT}`);
  console.log(`AI provider: ${AI_PROVIDER}`);
});
