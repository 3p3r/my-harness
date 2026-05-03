import logging

from litellm.integrations.custom_logger import CustomLogger
from litellm.proxy.proxy_server import UserAPIKeyAuth, DualCache
from typing import Any, Literal

logger = logging.getLogger(__name__)

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

        return data


# Instance that LiteLLM proxy will import
proxy_handler_instance = ProxyHandler()
