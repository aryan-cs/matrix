# matrix

simulate anything

## LiveAvatar batch generation

Create session tokens (and optionally start sessions) from `data.csv`:

```bash
export LIVEAVATAR_API_KEY="your_api_key"
python avatars/generate_avatars.py \
  --csv data.csv \
  --avatar-id 7b888024-f8c9-4205-95e1-78ce01497bda \
  --voice-id c2527536-6d1f-4412-a643-53a3497dada9 \
  --context-id 13469ff7-5089-4dce-8883-1e15f8879915 \
  --start \
  --out avatars/sessions.jsonl
```
