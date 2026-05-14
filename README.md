# Creful AI Tutor

Production rollout project for Creful AI Tutor / Site Co-pilot.

## Stack

- Static frontend
- Vercel deploy
- n8n backend workflow
- OpenRouter LLM provider
- Notion KB source of truth

## KB Sync Admin

The interface calls `/api/sync-kb` before triggering the Notion-to-JSON KB sync webhook.

Optional Vercel environment variables:

- `KB_SYNC_PASSWORD` defaults to `CrefulAI`
- `KB_SYNC_WEBHOOK_URL` defaults to `https://ct-automation.builk.com/webhook/creful-kb-sync`
