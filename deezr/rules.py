import hashlib
import json
import logging

from litellm.integrations.custom_logger import CustomLogger
from litellm.proxy.proxy_server import UserAPIKeyAuth, DualCache
from typing import Any, Literal

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


class ProxyHandler(CustomLogger):
    async def async_pre_call_hook(
        self,
        user_api_key_dict: UserAPIKeyAuth,
        cache: DualCache,
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

        return data


# Instance that LiteLLM proxy will import
proxy_handler_instance = ProxyHandler()
