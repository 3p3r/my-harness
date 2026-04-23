from vllm.entrypoints.openai.chat_completion.protocol import (
    ChatCompletionNamedToolChoiceParam,
    ChatCompletionRequest,
)
from vllm.entrypoints.openai.responses.protocol import ResponsesRequest
from vllm.tool_parsers import ToolParserManager
from vllm.tool_parsers.qwen3coder_tool_parser import Qwen3CoderToolParser


@ToolParserManager.register_module("qwen3_coder_named_safe")
class Qwen3CoderNamedSafeToolParser(Qwen3CoderToolParser):
    supports_required_and_named = False

    @staticmethod
    def _tool_name(tool) -> str | None:
        function = getattr(tool, "function", None)
        if function is None and isinstance(tool, dict):
            function = tool.get("function")

        if function is None:
            return None
        if isinstance(function, dict):
            return function.get("name")
        return getattr(function, "name", None)

    def _rewrite_to_auto_parser_path(
        self,
        request: ChatCompletionRequest | ResponsesRequest,
        named_tool: str | None = None,
    ) -> ChatCompletionRequest | ResponsesRequest:
        if named_tool:
            matching_tools = [
                tool for tool in request.tools or [] if self._tool_name(tool) == named_tool
            ]
            if matching_tools:
                request.tools = matching_tools

        request.tool_choice = "auto"
        chat_template_kwargs = dict(getattr(request, "chat_template_kwargs", {}) or {})
        chat_template_kwargs["enable_thinking"] = False
        request.chat_template_kwargs = chat_template_kwargs
        if hasattr(request, "include_reasoning"):
            request.include_reasoning = False

        if hasattr(request, "structured_outputs"):
            request.structured_outputs = None
        if hasattr(request, "response_format"):
            request.response_format = None
        if hasattr(request, "text"):
            request.text = None

        request.skip_special_tokens = False
        return request

    def adjust_request(
        self, request: ChatCompletionRequest | ResponsesRequest
    ) -> ChatCompletionRequest | ResponsesRequest:
        if request.tools:
            tool_choice = request.tool_choice
            if isinstance(tool_choice, ChatCompletionNamedToolChoiceParam):
                return self._rewrite_to_auto_parser_path(
                    request, named_tool=tool_choice.function.name
                )
            if tool_choice == "required":
                return self._rewrite_to_auto_parser_path(request)

        request = super().adjust_request(request)
        if request.tools and request.tool_choice != "none":
            request.skip_special_tokens = False
        return request