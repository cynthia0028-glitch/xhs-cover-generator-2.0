# XHS Cover Generator

Public web app for Xiaohongshu cover generation. The frontend collects images, title, subtitle, and style. The backend keeps API keys private and calls an image model.

## Render Environment Variables

For Volcengine Ark / Seedream:

```text
AI_PROVIDER=ark
ARK_API_KEY=your-ark-api-key
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_IMAGE_MODEL=doubao-seedream-5-0-260128
ARK_IMAGE_SIZE=2K
ARK_WATERMARK=false
```

For OpenAI instead:

```text
AI_PROVIDER=openai
OPENAI_API_KEY=sk-your-key
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_IMAGE_SIZE=1024x1536
```

Render start command:

```text
node server.js
```

## Local Run

```powershell
Copy-Item .env.example .env
node server.js
```

Open:

```text
http://localhost:3000
```

## Security

Do not upload `.env`. Keep API keys only in backend environment variables.
