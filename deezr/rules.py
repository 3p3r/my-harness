"""LiteLLM proxy callbacks: system-message merge and optional doom-loop transcript reset. Toggle doom handling with DEEZR_DOOM_DETECT (default on)."""


import hashlib
import json
import logging
import os
from collections import Counter
from itertools import combinations, groupby
from typing import Any, Literal

from litellm.integrations.custom_logger import CustomLogger

logger = logging.getLogger(__name__)


def _first_text_snippet(msg: dict, max_len: int) -> str:
    content = msg.get("content")
    if isinstance(content, str):
        return content[:max_len]
    if content is not None:
        try:
            return json.dumps(content, ensure_ascii=False)[:max_len]
        except (TypeError, ValueError):
            return str(content)[:max_len]
    return ""


def _session_id_for_affinity(data: dict, messages: list) -> str | None:
    """Stable per-conversation id for LiteLLM session_affinity (router pins one Gemma host)."""
    u = data.get("user")
    if isinstance(u, str) and u.strip():
        return u.strip()[:256]
    sys_snip = ""
    usr_snip = ""
    for m in messages:
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        if role == "system" and not sys_snip:
            sys_snip = _first_text_snippet(m, 4096)
        elif role == "user" and not usr_snip:
            usr_snip = _first_text_snippet(m, 8192)
        if sys_snip and usr_snip:
            break
    if not sys_snip and not usr_snip:
        return None
    h = hashlib.sha256()
    h.update(sys_snip.encode("utf-8", errors="replace"))
    h.update(b"\0")
    h.update(usr_snip.encode("utf-8", errors="replace"))
    return h.hexdigest()


def _inject_litellm_session_id(data: dict, session_id: str) -> None:
    for key in ("metadata", "litellm_metadata"):
        md = data.get(key)
        if not isinstance(md, dict):
            md = {}
            data[key] = md
        md["session_id"] = session_id


def _doom_enabled() -> bool:
    v = os.environ.get("DEEZR_DOOM_DETECT", "1").strip().lower()
    return v not in ("0", "false", "no", "off")


# Doom-loop: text similarity; identical tool args (fingerprint); sliding tail of identical
# fingerprints; long streaks of the same *tool name* only for bash/task (avoids read/edit/glob FPs).
_DOOM_TEXT_WINDOW = 4
_DOOM_TEXT_MAX_CHARS = 8192
_DOOM_TEXT_SIM_MIN = 0.88
_DOOM_TEXT_SIM_AVG = 0.78
_DOOM_TOOL_CONSEC = 5
_DOOM_TOOL_WINDOW = 8
_DOOM_TOOL_WINDOW_MAX_REPEAT = 4
_DOOM_BASH_NAME_CONSEC = 12
_DOOM_TASK_NAME_CONSEC = 7


def _assistant_visible_text(msg: dict, max_chars: int) -> str:
    content = msg.get("content")
    if content is None:
        return ""
    if isinstance(content, str):
        return content.strip()[:max_chars]
    if isinstance(content, list):
        chunks: list[str] = []
        for part in content:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "text" and "text" in part:
                chunks.append(str(part.get("text", "")))
        return "\n".join(chunks).strip()[:max_chars]
    try:
        return str(content).strip()[:max_chars]
    except Exception:
        return ""


def _collect_assistant_texts(messages: list, max_chars: int = _DOOM_TEXT_MAX_CHARS) -> list[str]:
    out: list[str] = []
    for m in messages:
        if not isinstance(m, dict) or m.get("role") != "assistant":
            continue
        t = _assistant_visible_text(m, max_chars)
        if t:
            out.append(t)
    return out


def _token_jaccard(a: str, b: str) -> float:
    ta = set(a.lower().split())
    tb = set(b.lower().split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _fingerprint_tool_call(tc: dict) -> str | None:
    if not isinstance(tc, dict):
        return None
    fn = tc.get("function")
    if not isinstance(fn, dict):
        return None
    name = fn.get("name") or ""
    args = fn.get("arguments", "")
    if isinstance(args, str):
        s = args.strip()
        if s:
            try:
                parsed = json.loads(s)
            except (json.JSONDecodeError, TypeError, ValueError):
                parsed = None
            if isinstance(parsed, dict):
                # Drop labels that often differ without changing the real action.
                slim = {
                    k: v
                    for k, v in parsed.items()
                    if k not in ("description", "title", "metadata")
                }
                norm_args = json.dumps(slim, sort_keys=True, ensure_ascii=False, default=str)
            else:
                norm_args = s
        else:
            norm_args = ""
    elif isinstance(args, dict):
        slim = {k: v for k, v in args.items() if k not in ("description", "title", "metadata")}
        norm_args = json.dumps(slim, sort_keys=True, ensure_ascii=False, default=str)
    elif isinstance(args, list):
        norm_args = json.dumps(args, sort_keys=True, ensure_ascii=False)
    else:
        norm_args = str(args)
    blob = json.dumps({"name": name, "arguments": norm_args}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8", errors="replace")).hexdigest()[:40]


def _ordered_tool_fingerprints(messages: list) -> list[str]:
    out: list[str] = []
    for m in messages:
        if not isinstance(m, dict) or m.get("role") != "assistant":
            continue
        tcs = m.get("tool_calls")
        if not isinstance(tcs, list):
            continue
        for tc in tcs:
            fp = _fingerprint_tool_call(tc)
            if fp:
                out.append(fp)
    return out


def _ordered_tool_names(messages: list) -> list[str]:
    out: list[str] = []
    for m in messages:
        if not isinstance(m, dict) or m.get("role") != "assistant":
            continue
        tcs = m.get("tool_calls")
        if not isinstance(tcs, list):
            continue
        for tc in tcs:
            fn = tc.get("function") if isinstance(tc, dict) else None
            if isinstance(fn, dict):
                n = fn.get("name")
                if isinstance(n, str) and n:
                    out.append(n)
    return out


def _max_consecutive_run_for_tool(names: list[str], target: str) -> int:
    """Longest run of identical tool `function.name` equal to `target` (e.g. bash-only streak)."""
    best = 0
    for k, g in groupby(names):
        if k != target:
            continue
        best = max(best, len(list(g)))
    return best


def _max_consecutive_same(seq: list[str]) -> int:
    if not seq:
        return 0
    best = 1
    cur = 1
    prev = seq[0]
    for x in seq[1:]:
        if x == prev:
            cur += 1
            best = max(best, cur)
        else:
            cur = 1
            prev = x
    return best


def _max_count_in_tail(seq: list[str], window: int) -> tuple[int, str | None]:
    if not seq or window < 1:
        return 0, None
    tail = seq[-window:]
    ctr = Counter(tail)
    fp, n = ctr.most_common(1)[0]
    return n, fp


def _last_user_text(messages: list, max_chars: int = _DOOM_TEXT_MAX_CHARS) -> str | None:
    last: str | None = None
    for m in messages:
        if isinstance(m, dict) and m.get("role") == "user":
            t = _assistant_visible_text(m, max_chars)
            if t:
                last = t
    return last


def _take_system_message(messages: list) -> dict:
    for m in messages:
        if isinstance(m, dict) and m.get("role") == "system":
            return {"role": "system", "content": m.get("content", "")}
    return {"role": "system", "content": ""}


def doom_check_text_similarity(messages: list) -> tuple[bool, str]:
    w = max(2, _DOOM_TEXT_WINDOW)
    texts = _collect_assistant_texts(messages)
    if len(texts) < 2:
        return False, ""
    tail = texts[-w:]
    if len(tail) < 2:
        return False, ""

    sims = [_token_jaccard(tail[i], tail[j]) for i, j in combinations(range(len(tail)), 2)]
    mn = min(sims)
    av = sum(sims) / len(sims)
    if mn >= _DOOM_TEXT_SIM_MIN or av >= _DOOM_TEXT_SIM_AVG:
        return True, (
            f"text_similarity window={len(tail)} min_jaccard={mn:.3f} avg_jaccard={av:.3f} "
            f"(thresholds min>={_DOOM_TEXT_SIM_MIN} avg>={_DOOM_TEXT_SIM_AVG})"
        )
    return False, ""


def doom_check_tool_repeat(messages: list) -> tuple[bool, str]:
    fps = _ordered_tool_fingerprints(messages)
    if fps:
        consec = _max_consecutive_same(fps)
        if consec >= _DOOM_TOOL_CONSEC:
            return True, f"tool_repeat consecutive={consec} (threshold>={_DOOM_TOOL_CONSEC})"

        cnt, _fp = _max_count_in_tail(fps, _DOOM_TOOL_WINDOW)
        if cnt >= _DOOM_TOOL_WINDOW_MAX_REPEAT:
            return True, (
                f"tool_repeat tail_window={_DOOM_TOOL_WINDOW} max_same={cnt} "
                f"(threshold>={_DOOM_TOOL_WINDOW_MAX_REPEAT})"
            )

    names = _ordered_tool_names(messages)
    if names:
        bash_run = _max_consecutive_run_for_tool(names, "bash")
        if bash_run >= _DOOM_BASH_NAME_CONSEC:
            return True, (
                f"tool_name_streak name=bash consecutive={bash_run} "
                f"(threshold>={_DOOM_BASH_NAME_CONSEC})"
            )
        task_run = _max_consecutive_run_for_tool(names, "task")
        if task_run >= _DOOM_TASK_NAME_CONSEC:
            return True, (
                f"tool_name_streak name=task consecutive={task_run} "
                f"(threshold>={_DOOM_TASK_NAME_CONSEC})"
            )

    return False, ""


def doom_reset_messages(messages: list, reason: str) -> list[dict]:
    system = _take_system_message(messages)
    last_u = _last_user_text(messages)
    preamble = (
        "[deezr proxy] The transcript was shortened after detecting repetitive "
        "assistant output or repeated tool calls with identical arguments. "
        "Do not repeat the same failing tool sequence; continue from first principles.\n\n"
        f"(detector: {reason})\n\n"
    )
    anchor = last_u or "(No prior user message in context; respond helpfully.)"
    body = f"{preamble}---\n\nTask (latest user request):\n{anchor}"
    return [system, {"role": "user", "content": body}]


def doom_maybe_reset_transcript(messages: list) -> tuple[list, bool, str]:
    if not _doom_enabled():
        return messages, False, ""

    t_hit, t_detail = doom_check_text_similarity(messages)
    g_hit, g_detail = doom_check_tool_repeat(messages)

    if t_hit:
        new_msgs = doom_reset_messages(messages, t_detail)
        return new_msgs, True, t_detail
    if g_hit:
        new_msgs = doom_reset_messages(messages, g_detail)
        return new_msgs, True, g_detail
    return messages, False, ""


class ProxyHandler(CustomLogger):
    async def async_pre_call_hook(
        self,
        user_api_key_dict: Any,
        cache: Any,
        data: dict,
        call_type: Literal[
            "completion", "text_completion", "embeddings",
            "image_generation", "moderation", "audio_transcription"
        ],
    ):
        """Merge multiple system messages into one and ensure it is always first."""
        if "messages" not in data or not isinstance(data["messages"], list):
            return data

        messages = data["messages"]
        system_indices = [
            i for i, msg in enumerate(messages)
            if isinstance(msg, dict) and msg.get("role") == "system"
        ]

        logger.info("pre_call_hook: %d system messages in %d total messages",
                     len(system_indices), len(messages))

        if len(system_indices) > 1:
            system_msgs = [messages[i] for i in system_indices]
            parts = []
            for msg in system_msgs:
                content = msg.get("content")
                if content is None:
                    continue
                if not isinstance(content, str):
                    content = str(content)
                content = content.strip()
                if not content:
                    continue
                name = msg.get("name", "")
                parts.append(f"[{name}]\n{content}" if name else content)

            merged_content = "\n\n".join(parts)
            logger.info("pre_call_hook: merged %d system messages → %d chars",
                         len(system_indices), len(merged_content))

            for i in reversed(system_indices):
                del messages[i]

            messages.insert(0, {"role": "system", "content": merged_content})

        elif len(system_indices) == 1:
            idx = system_indices[0]
            if idx != 0:
                system_msg = messages.pop(idx)
                messages.insert(0, system_msg)
                logger.info("pre_call_hook: moved system from index %d to 0", idx)

        if messages:
            first = messages[0]
            role = first.get("role") if isinstance(first, dict) else type(first).__name__
            logger.info("pre_call_hook: first message role=%s", role)

        sid = _session_id_for_affinity(data, messages)
        if sid:
            _inject_litellm_session_id(data, sid)

        new_msgs, changed, detail = doom_maybe_reset_transcript(messages)
        if changed:
            logger.warning(
                "pre_call_hook: doom_loop_reset session_id=%s msgs_before=%d msgs_after=%d %s",
                sid or "?",
                len(messages),
                len(new_msgs),
                detail,
            )
            data["messages"] = new_msgs

        return data


# Instance that LiteLLM proxy will import
proxy_handler_instance = ProxyHandler()
