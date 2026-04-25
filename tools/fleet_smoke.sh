#!/usr/bin/env bash

set -euo pipefail

pass() {
  printf 'PASS %s\n' "$1"
}

check_status() {
  local label=$1
  local url=$2

  curl -fsS --retry 5 --retry-delay 1 --retry-all-errors --retry-connrefused --max-time 60 "$url" >/dev/null
  pass "$label"
}

check_get_json() {
  local label=$1
  local url=$2
  local expr=$3
  local response

  response=$(curl -sS --retry 5 --retry-delay 1 --retry-all-errors --retry-connrefused --max-time 180 "$url")
  printf '%s\n' "$response" | jq -e "$expr" >/dev/null
  pass "$label"
}

check_post_json() {
  local label=$1
  local url=$2
  local data=$3
  local expr=$4
  local response

  response=$(curl -sS --retry 5 --retry-delay 1 --retry-all-errors --retry-connrefused --max-time 300 -H 'Content-Type: application/json' "$url" -d "$data")
  printf '%s\n' "$response" | jq -e "$expr" >/dev/null
  pass "$label"
}

check_post_json_once() {
  local label=$1
  local url=$2
  local data=$3
  local expr=$4
  local response_file
  local status

  response_file=$(mktemp)
  if ! status=$(curl -sS --max-time 300 -o "$response_file" -w '%{http_code}' -H 'Content-Type: application/json' "$url" -d "$data"); then
    rm -f "$response_file"
    return 1
  fi

  if [[ "$status" != "200" ]]; then
    printf 'FAIL %s status=%s\n' "$label" "$status" >&2
    cat "$response_file" >&2
    rm -f "$response_file"
    return 1
  fi

  jq -e "$expr" "$response_file" >/dev/null
  rm -f "$response_file"
  pass "$label"
}

check_python_json() {
  local label=$1
  local expr=$2
  local mode=$3
  local url=$4
  local model=$5
  local response

  response=$(python3 - "$mode" "$url" "$model" <<'PY'
import base64
import json
import struct
import sys
import urllib.error
import urllib.request
import zlib


def png_chunk(tag: bytes, data: bytes) -> bytes:
  return (
    struct.pack('>I', len(data))
    + tag
    + data
    + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
  )


def make_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
  header = b'\x89PNG\r\n\x1a\n'
  ihdr = png_chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
  row = b'\x00' + bytes(rgb) * width
  raw = row * height
  idat = png_chunk(b'IDAT', zlib.compress(raw, 9))
  iend = png_chunk(b'IEND', b'')
  return header + ihdr + idat + iend


def post_json(url: str, payload: dict) -> dict:
  req = urllib.request.Request(
    url,
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
  )
  with urllib.request.urlopen(req, timeout=600) as response:
    return json.load(response)


mode, url, model = sys.argv[1:4]

try:
  if mode == "gemma4-reasoning":
    payload = {
      "model": model,
      "messages": [
        {
          "role": "user",
          "content": "Which is greater, 9.11 or 9.8? Answer briefly.",
        }
      ],
      "chat_template_kwargs": {"enable_thinking": True},
      "reasoning_format": "deepseek",
      "temperature": 0,
      "max_tokens": 256,
    }
  elif mode == "gemma4-mm":
    png_b64 = base64.b64encode(make_png(8, 8, (255, 0, 0))).decode()
    payload = {
      "model": model,
      "messages": [
        {
          "role": "user",
          "content": [
            {
              "type": "image_url",
              "image_url": {"url": f"data:image/png;base64,{png_b64}"},
            },
            {
              "type": "text",
              "text": "What color is this square? Answer with one word.",
            },
          ],
        }
      ],
      "chat_template_kwargs": {"enable_thinking": False},
      "temperature": 0,
      "max_tokens": 64,
    }
  elif mode == "gemma4-longctx":
    payload = {
      "model": model,
      "messages": [
        {
          "role": "user",
          "content": (
            ("alpha " * 40000)
            + "\n\nThe previous text is filler. Reply with exactly one word: ready."
          ),
        }
      ],
      "chat_template_kwargs": {"enable_thinking": False},
      "temperature": 0,
      "max_tokens": 32,
    }
  elif mode == "qwen-tool-longctx":
    payload = {
      "model": model,
      "messages": [
        {
          "role": "user",
          "content": (
            ("alpha " * 25500)
            + "\n\nCall get_time with timezone UTC. Do not answer with plain text."
          ),
        }
      ],
      "tools": [
        {
          "type": "function",
          "function": {
            "name": "get_time",
            "description": "Get time for a timezone.",
            "parameters": {
              "type": "object",
              "properties": {"timezone": {"type": "string"}},
              "required": ["timezone"],
            },
          },
        }
      ],
      "chat_template_kwargs": {"enable_thinking": False},
      "tool_choice": "required",
      "temperature": 0,
      "max_tokens": 256,
    }
  elif mode == "qwen-tool-over32k":
    payload = {
      "model": model,
      "messages": [
        {
          "role": "user",
          "content": (
            ("alpha " * 40000)
            + "\n\nCall get_time with timezone UTC. Do not answer with plain text."
          ),
        }
      ],
      "tools": [
        {
          "type": "function",
          "function": {
            "name": "get_time",
            "description": "Get time for a timezone.",
            "parameters": {
              "type": "object",
              "properties": {"timezone": {"type": "string"}},
              "required": ["timezone"],
            },
          },
        }
      ],
      "chat_template_kwargs": {"enable_thinking": False},
      "tool_choice": "required",
      "temperature": 0,
      "max_tokens": 256,
    }
  else:
    raise ValueError(f"unsupported mode: {mode}")

  print(json.dumps(post_json(url, payload)))
except urllib.error.HTTPError as exc:
  print(exc.read().decode(), file=sys.stderr)
  raise
PY
  )

  printf '%s\n' "$response" | jq -e "$expr" >/dev/null
  pass "$label"
}

check_header_rotation() {
  local label=$1
  local count=$2
  local min_unique=$3
  local url=$4
  local data=$5
  local ids
  local unique_count

  ids=$(
    for _ in $(seq "$count"); do
      curl -fsS --retry 3 --retry-delay 1 --retry-all-errors --retry-connrefused --max-time 300 -D - -o /dev/null -H 'Content-Type: application/json' "$url" -d "$data" \
        | tr -d '\r' \
        | awk -F': ' 'tolower($1) == "x-litellm-model-id" { print $2 }'
    done | sed '/^$/d' | sort -u
  )

  unique_count=$(printf '%s\n' "$ids" | sed '/^$/d' | wc -l)
  if (( unique_count < min_unique )); then
    printf 'FAIL %s unique_model_ids=%s\n' "$label" "$unique_count" >&2
    printf '%s\n' "$ids" >&2
    return 1
  fi

  pass "$label"
}

run_parallel_json_post() {
  local label=$1
  local count=$2
  local parallelism=$3
  local url=$4
  local data=$5
  local expr=$6

  export URL="$url" DATA="$data" EXPR="$expr"
  seq "$count" | xargs -P "$parallelism" -I{} bash --noprofile --norc -lc '
    response=$(curl -sS --retry 3 --retry-delay 1 --retry-all-errors --retry-connrefused --max-time 180 -H "Content-Type: application/json" "$URL" -d "$DATA")
    printf "%s\n" "$response" | jq -e "$EXPR" >/dev/null
  '
  pass "$label"
}

check_python_long_context() {
  local label=$1
  local url=$2
  local model=$3
  local expected_ctx=$4

  python3 - "$url" "$model" "$expected_ctx" <<'PY'
import json
import sys
import urllib.request


def get_json(url: str) -> dict:
  with urllib.request.urlopen(url, timeout=120) as response:
    return json.load(response)


url, model, expected_ctx = sys.argv[1], sys.argv[2], int(sys.argv[3])
props = get_json(url.replace('/v1/chat/completions', '/props'))
ctx = props.get('default_generation_settings', {}).get('n_ctx', 0)
if ctx < expected_ctx:
  raise SystemExit(f"ctx={ctx} model={model}")
PY
  pass "$label"
}

run_parallel_get() {
  local label=$1
  local count=$2
  local parallelism=$3
  local url=$4
  local expr=$5

  export URL="$url" EXPR="$expr"
  seq "$count" | xargs -P "$parallelism" -I{} bash --noprofile --norc -lc '
    response=$(curl -sS --retry 3 --retry-delay 1 --retry-all-errors --retry-connrefused --max-time 120 "$URL")
    printf "%s\n" "$response" | jq -e "$EXPR" >/dev/null
  '
  pass "$label"
}

DEEZ1_CHAT='{"model":"Qwen/Qwen3.6-35B-A3B","messages":[{"role":"user","content":"Reply with ok."}],"chat_template_kwargs":{"enable_thinking":false},"temperature":0,"max_tokens":64}'
DEEZ1_TOOL=$(cat <<'JSON'
{"model":"Qwen/Qwen3.6-35B-A3B","messages":[{"role":"user","content":"Call get_time with timezone UTC. Do not answer with plain text."}],"chat_template_kwargs":{"enable_thinking":false},"tools":[{"type":"function","function":{"name":"get_time","description":"Get time for a timezone.","parameters":{"type":"object","properties":{"timezone":{"type":"string"}},"required":["timezone"]}}}],"tool_choice":"required","temperature":0,"max_tokens":256}
JSON
)
DEEZ2_CHAT='{"model":"TrevorJS/gemma-4-26B-A4B-it-uncensored","messages":[{"role":"user","content":"Reply with exactly one word: ready."}],"chat_template_kwargs":{"enable_thinking":false},"max_tokens":96}'
DEEZ2_TOOL=$(cat <<'JSON'
{"model":"TrevorJS/gemma-4-26B-A4B-it-uncensored","messages":[{"role":"user","content":"Call get_time with timezone UTC. Do not answer with plain text."}],"tools":[{"type":"function","function":{"name":"get_time","description":"Get time for a timezone.","parameters":{"type":"object","properties":{"timezone":{"type":"string"}},"required":["timezone"]}}}],"tool_choice":{"type":"function","function":{"name":"get_time"}},"chat_template_kwargs":{"enable_thinking":false},"temperature":0,"max_tokens":256}
JSON
)
DEEZX_TOOL=$(cat <<'JSON'
{"model":"Qwen/Qwen3-14B","messages":[{"role":"user","content":"Call get_time with timezone UTC. Do not answer with plain text."}],"tools":[{"type":"function","function":{"name":"get_time","description":"Get time for a timezone.","parameters":{"type":"object","properties":{"timezone":{"type":"string"}},"required":["timezone"]}}}],"tool_choice":"required","temperature":0,"max_tokens":256}
JSON
)

PROXY_CODING='{"model":"coding","messages":[{"role":"user","content":"Reply with ok."}],"max_tokens":64}'
PROXY_CODING_TOOL=$(cat <<'JSON'
{"model":"coding","messages":[{"role":"user","content":"Call get_time with timezone UTC. Do not answer with plain text."}],"tools":[{"type":"function","function":{"name":"get_time","description":"Get time for a timezone.","parameters":{"type":"object","properties":{"timezone":{"type":"string"}},"required":["timezone"]}}}],"tool_choice":"required","temperature":0,"max_tokens":256}
JSON
)
PROXY_THINKING='{"model":"thinking","messages":[{"role":"user","content":"Reply with exactly one word: ready."}],"chat_template_kwargs":{"enable_thinking":false},"max_tokens":96}'
PROXY_THINKING_TOOL=$(cat <<'JSON'
{"model":"thinking","messages":[{"role":"user","content":"Call get_time with timezone UTC. Do not answer with plain text."}],"tools":[{"type":"function","function":{"name":"get_time","description":"Get time for a timezone.","parameters":{"type":"object","properties":{"timezone":{"type":"string"}},"required":["timezone"]}}}],"tool_choice":{"type":"function","function":{"name":"get_time"}},"chat_template_kwargs":{"enable_thinking":false},"temperature":0,"max_tokens":256}
JSON
)
PROXY_THINKING_DEEP_REASONING='{"model":"thinking-deep","messages":[{"role":"user","content":"Which is greater, 9.11 or 9.8? Answer briefly."}],"temperature":0,"max_tokens":256}'
PROXY_RESEARCH_TOOL=$(cat <<'JSON'
{"model":"research","messages":[{"role":"user","content":"Call get_time with timezone UTC. Do not answer with plain text."}],"tools":[{"type":"function","function":{"name":"get_time","description":"Get time for a timezone.","parameters":{"type":"object","properties":{"timezone":{"type":"string"}},"required":["timezone"]}}}],"tool_choice":"required","temperature":0,"max_tokens":256}
JSON
)
PROXY_HAIKU_TOOL=$(cat <<'JSON'
{"model":"haiku","messages":[{"role":"user","content":"Call get_time with timezone UTC. Do not answer with plain text."}],"tools":[{"type":"function","function":{"name":"get_time","description":"Get time for a timezone.","parameters":{"type":"object","properties":{"timezone":{"type":"string"}},"required":["timezone"]}}}],"tool_choice":"required","temperature":0,"max_tokens":256}
JSON
)

printf '== Basic ==\n'
check_status deez1-health http://192.168.1.95:8010/health
check_get_json deez1-models http://192.168.1.95:8010/v1/models '.data[0].id == "Qwen/Qwen3.6-35B-A3B"'
check_python_long_context deez1-props http://192.168.1.95:8010/v1/chat/completions Qwen/Qwen3.6-35B-A3B 262144
check_get_json deez1-slots http://192.168.1.95:8010/slots 'length == 4 and all(.[]; .n_ctx == 262144)'
check_post_json deez1-chat http://192.168.1.95:8010/v1/chat/completions "$DEEZ1_CHAT" '.choices[0].message.role == "assistant"'
check_post_json deez1-tool-call http://192.168.1.95:8010/v1/chat/completions "$DEEZ1_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time" and (.choices[0].message.tool_calls[0].function.arguments | fromjson | .timezone) == "UTC"'
check_python_json deez1-tool-over32k '.usage.prompt_tokens > 39000 and .choices[0].message.tool_calls[0].function.name == "get_time"' qwen-tool-over32k http://192.168.1.95:8010/v1/chat/completions Qwen/Qwen3.6-35B-A3B

check_status deez2-health-a http://192.168.1.114:8000/health
check_status deez2-health-b http://192.168.1.114:8001/health
check_get_json deez2-models-a http://192.168.1.114:8000/v1/models '.data[0].id == "TrevorJS/gemma-4-26B-A4B-it-uncensored"'
check_python_long_context deez2-props-a http://192.168.1.114:8000/v1/chat/completions TrevorJS/gemma-4-26B-A4B-it-uncensored 262144
check_get_json deez2-slots-a http://192.168.1.114:8000/slots 'length == 2 and all(.[]; .n_ctx == 262144)'
check_get_json deez2-models-b http://192.168.1.114:8001/v1/models '.data[0].id == "TrevorJS/gemma-4-26B-A4B-it-uncensored"'
check_python_long_context deez2-props-b http://192.168.1.114:8001/v1/chat/completions TrevorJS/gemma-4-26B-A4B-it-uncensored 262144
check_get_json deez2-slots-b http://192.168.1.114:8001/slots 'length == 2 and all(.[]; .n_ctx == 262144)'
check_post_json deez2-chat-a http://192.168.1.114:8000/v1/chat/completions "$DEEZ2_CHAT" '.choices[0].message.role == "assistant"'
check_post_json_once deez2-tool-call-b http://192.168.1.114:8001/v1/chat/completions "$DEEZ2_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time" and (.choices[0].message.tool_calls[0].function.arguments | fromjson | .timezone) == "UTC" and ((.choices[0].message.content // "") | contains("<think>") | not)'
check_python_json deez2-reasoning '.choices[0].message.reasoning_content != null and (.choices[0].message.content | ascii_downcase | contains("9.8"))' gemma4-reasoning http://192.168.1.114:8000/v1/chat/completions TrevorJS/gemma-4-26B-A4B-it-uncensored
check_python_json deez2-multimodal '.choices[0].message.content | ascii_downcase | test("red")' gemma4-mm http://192.168.1.114:8000/v1/chat/completions TrevorJS/gemma-4-26B-A4B-it-uncensored
check_python_json deez2-long-context '.choices[0].message.content | ascii_downcase | test("ready")' gemma4-longctx http://192.168.1.114:8000/v1/chat/completions TrevorJS/gemma-4-26B-A4B-it-uncensored

check_status deezx-health http://192.168.1.161:8000/health
check_get_json deezx-models-a http://192.168.1.161:8000/v1/models '.data[0].id == "Qwen/Qwen3-14B"'
check_python_long_context deezx-props-a http://192.168.1.161:8000/v1/chat/completions Qwen/Qwen3-14B 32768
check_status deezx-haiku-health http://192.168.1.161:8001/health
check_get_json deezx-models-b http://192.168.1.161:8001/v1/models '.data[0].id == "Qwen/Qwen3-14B"'
check_python_long_context deezx-props-b http://192.168.1.161:8001/v1/chat/completions Qwen/Qwen3-14B 32768
check_post_json_once deezx-tool-call-a http://192.168.1.161:8000/v1/chat/completions "$DEEZX_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time"'
check_post_json_once deezx-tool-call-b http://192.168.1.161:8001/v1/chat/completions "$DEEZX_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time"'
check_python_json deezx-tool-long-context-a '.usage.prompt_tokens > 25000 and .choices[0].message.tool_calls[0].function.name == "get_time"' qwen-tool-longctx http://192.168.1.161:8000/v1/chat/completions Qwen/Qwen3-14B
check_python_json deezx-tool-long-context-b '.usage.prompt_tokens > 25000 and .choices[0].message.tool_calls[0].function.name == "get_time"' qwen-tool-longctx http://192.168.1.161:8001/v1/chat/completions Qwen/Qwen3-14B

check_get_json deezr-models http://192.168.1.85:4000/v1/models '([.data[].id] | index("thinking")) != null and ([.data[].id] | index("thinking-deep")) != null and ([.data[].id] | index("coding")) != null and ([.data[].id] | index("research")) != null'
check_post_json deezr-coding http://192.168.1.85:4000/v1/chat/completions "$PROXY_CODING" '.choices[0].message.role == "assistant"'
check_post_json deezr-coding-tool-call http://192.168.1.85:4000/v1/chat/completions "$PROXY_CODING_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time" and (.choices[0].message.tool_calls[0].function.arguments | fromjson | .timezone) == "UTC" and ((.choices[0].message.content // "") | contains("<think>") | not)'
check_python_json deezr-coding-tool-over32k '.usage.prompt_tokens > 39000 and .choices[0].message.tool_calls[0].function.name == "get_time" and ((.choices[0].message.content // "") | contains("<think>") | not)' qwen-tool-over32k http://192.168.1.85:4000/v1/chat/completions coding
check_post_json deezr-thinking http://192.168.1.85:4000/v1/chat/completions "$PROXY_THINKING" '.choices[0].message.role == "assistant"'
check_post_json deezr-thinking-tool-call http://192.168.1.85:4000/v1/chat/completions "$PROXY_THINKING_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time" and (.choices[0].message.tool_calls[0].function.arguments | fromjson | .timezone) == "UTC" and ((.choices[0].message.content // "") | contains("<think>") | not)'
check_post_json deezr-thinking-deep-reasoning http://192.168.1.85:4000/v1/chat/completions "$PROXY_THINKING_DEEP_REASONING" '.choices[0].message.role == "assistant" and .choices[0].message.reasoning_content != null'
check_python_json deezr-thinking-multimodal '.choices[0].message.content | ascii_downcase | test("red")' gemma4-mm http://192.168.1.85:4000/v1/chat/completions thinking
check_post_json deezr-research-tool-call http://192.168.1.85:4000/v1/chat/completions "$PROXY_RESEARCH_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time" and ((.choices[0].message.content // "") | contains("<think>") | not)'
check_post_json deezr-haiku-tool-call http://192.168.1.85:4000/v1/chat/completions "$PROXY_HAIKU_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time" and ((.choices[0].message.content // "") | contains("<think>") | not)'
check_header_rotation deezr-coding-model-id-rotation 12 1 http://192.168.1.85:4000/v1/chat/completions "$PROXY_CODING"
check_header_rotation deezr-thinking-model-id-rotation 12 2 http://192.168.1.85:4000/v1/chat/completions "$PROXY_THINKING"

printf '== Repetition ==\n'
for iteration in 1 2 3; do
  check_post_json_once "deez1-tool-call-$iteration" http://192.168.1.95:8010/v1/chat/completions "$DEEZ1_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time" and (.choices[0].message.tool_calls[0].function.arguments | fromjson | .timezone) == "UTC"'
  check_post_json "deezr-coding-tool-call-$iteration" http://192.168.1.85:4000/v1/chat/completions "$PROXY_CODING_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time" and (.choices[0].message.tool_calls[0].function.arguments | fromjson | .timezone) == "UTC" and ((.choices[0].message.content // "") | contains("<think>") | not)'
  check_post_json "deezr-thinking-tool-call-$iteration" http://192.168.1.85:4000/v1/chat/completions "$PROXY_THINKING_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time" and (.choices[0].message.tool_calls[0].function.arguments | fromjson | .timezone) == "UTC" and ((.choices[0].message.content // "") | contains("<think>") | not)'
  check_post_json_once "deezx-tool-call-a-$iteration" http://192.168.1.161:8000/v1/chat/completions "$DEEZX_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time"'
  check_post_json_once "deezx-tool-call-b-$iteration" http://192.168.1.161:8001/v1/chat/completions "$DEEZX_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time"'
  check_post_json "deezr-research-tool-call-$iteration" http://192.168.1.85:4000/v1/chat/completions "$PROXY_RESEARCH_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time" and ((.choices[0].message.content // "") | contains("<think>") | not)'
  check_post_json "deezr-haiku-tool-call-$iteration" http://192.168.1.85:4000/v1/chat/completions "$PROXY_HAIKU_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time" and ((.choices[0].message.content // "") | contains("<think>") | not)'
done

printf '== Parallel ==\n'
run_parallel_json_post deez1-coding-parallel 4 4 http://192.168.1.95:8010/v1/chat/completions "$DEEZ1_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time" and (.choices[0].message.tool_calls[0].function.arguments | fromjson | .timezone) == "UTC"'
run_parallel_json_post deez2-thinking-parallel-a 4 2 http://192.168.1.114:8000/v1/chat/completions "$DEEZ2_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time" and (.choices[0].message.tool_calls[0].function.arguments | fromjson | .timezone) == "UTC" and ((.choices[0].message.content // "") | contains("<think>") | not)'
run_parallel_json_post deez2-thinking-parallel-b 4 2 http://192.168.1.114:8001/v1/chat/completions "$DEEZ2_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time" and (.choices[0].message.tool_calls[0].function.arguments | fromjson | .timezone) == "UTC" and ((.choices[0].message.content // "") | contains("<think>") | not)'
run_parallel_get deezr-models-parallel 12 4 http://192.168.1.85:4000/v1/models '([.data[].id] | index("thinking")) != null and ([.data[].id] | index("thinking-deep")) != null and ([.data[].id] | index("coding")) != null and ([.data[].id] | index("research")) != null'
run_parallel_json_post deezr-coding-parallel 4 4 http://192.168.1.85:4000/v1/chat/completions "$PROXY_CODING_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time" and (.choices[0].message.tool_calls[0].function.arguments | fromjson | .timezone) == "UTC" and ((.choices[0].message.content // "") | contains("<think>") | not)'
run_parallel_json_post deezr-thinking-parallel 8 4 http://192.168.1.85:4000/v1/chat/completions "$PROXY_THINKING_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time" and (.choices[0].message.tool_calls[0].function.arguments | fromjson | .timezone) == "UTC" and ((.choices[0].message.content // "") | contains("<think>") | not)'
run_parallel_json_post deezr-research-parallel 6 3 http://192.168.1.85:4000/v1/chat/completions "$PROXY_RESEARCH_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time"'
run_parallel_json_post deezr-haiku-parallel 6 3 http://192.168.1.85:4000/v1/chat/completions "$PROXY_HAIKU_TOOL" '.choices[0].message.tool_calls[0].function.name == "get_time"'

printf 'FLEET_SMOKE_OK\n'