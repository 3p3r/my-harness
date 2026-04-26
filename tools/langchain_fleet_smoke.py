#!/usr/bin/env python3

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import struct
import time
import zlib
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable
from zoneinfo import ZoneInfo

import httpx
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.messages import HumanMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI


API_KEY = "none"
DEEZ1_BASE = "http://192.168.1.95:8010/v1"
DEEZ2_BASE = "http://192.168.1.114:8000/v1"
DEEZ2_B_BASE = "http://192.168.1.114:8001/v1"
DEEZX_BASE = "http://192.168.1.161:8000/v1"
DEEZX_FAST_B_BASE = "http://192.168.1.161:8001/v1"
DEEZR_BASE = "http://192.168.1.85:4000/v1"

DEEZ1_ROOT = DEEZ1_BASE.removesuffix("/v1")
DEEZ2_ROOT = DEEZ2_BASE.removesuffix("/v1")
DEEZ2_B_ROOT = DEEZ2_B_BASE.removesuffix("/v1")

CODING_MODEL = "Qwen/Qwen3.6-35B-A3B"
THINKING_MODEL = "TrevorJS/gemma-4-26B-A4B-it-uncensored"
RESEARCH_MODEL = "Qwen/Qwen3.6-27B"

RESEARCH_SHORT_TOOL_MIN_PROMPT_TOKENS = 150
RESEARCH_LONG_TOOL_MIN_PROMPT_TOKENS = 100000
RESEARCH_LONG_TOOL_FILLER_WORDS = 100500


class SmokeFailure(RuntimeError):
    pass


@tool
def get_time(timezone: str) -> str:
    """Get the current time for an IANA timezone."""
    current_time = datetime.now(ZoneInfo(timezone)).isoformat()
    return f"LANGCHAIN_SMOKE_TIME[{timezone}]::{current_time}"


def png_chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def make_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    header = b"\x89PNG\r\n\x1a\n"
    ihdr = png_chunk(
        b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    )
    row = b"\x00" + bytes(rgb) * width
    raw = row * height
    idat = png_chunk(b"IDAT", zlib.compress(raw, 9))
    iend = png_chunk(b"IEND", b"")
    return header + ihdr + idat + iend


def make_agent_executor(llm: ChatOpenAI) -> AgentExecutor:
    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                "You are a smoke-test agent. Use tools when they are required and keep answers concise.",
            ),
            ("human", "{input}"),
            MessagesPlaceholder("agent_scratchpad"),
        ]
    )
    agent = create_tool_calling_agent(llm, [get_time], prompt)
    return AgentExecutor(
        agent=agent,
        tools=[get_time],
        return_intermediate_steps=True,
        verbose=False,
    )


@dataclass
class TestResult:
    name: str
    duration_seconds: float
    passed: bool
    detail: str


class LangChainFleetSmoke:
    def __init__(self, fail_fast: bool = False) -> None:
        self.fail_fast = fail_fast
        self.http = httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0))
        self.red_square_b64 = base64.b64encode(make_png(8, 8, (255, 0, 0))).decode()

        self.coding_routed = self.make_chat(
            "coding",
            DEEZR_BASE,
            timeout=120,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )

        self.coding_direct = self.make_chat(
            CODING_MODEL,
            DEEZ1_BASE,
            timeout=120,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )

        self.thinking_direct = self.make_chat(
            THINKING_MODEL,
            DEEZ2_BASE,
            timeout=300,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )
        self.thinking_direct_reasoning = self.make_chat(
            THINKING_MODEL,
            DEEZ2_BASE,
            timeout=300,
            extra_body={
                "chat_template_kwargs": {"enable_thinking": True},
                "reasoning_format": "deepseek",
            },
        )
        self.thinking_routed = self.make_chat(
            "thinking",
            DEEZR_BASE,
            timeout=300,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )
        self.thinking_deep_routed = self.make_chat(
            "thinking-deep",
            DEEZR_BASE,
            timeout=300,
        )

        self.research_direct = self.make_chat(
            RESEARCH_MODEL,
            DEEZX_BASE,
            timeout=300,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )
        self.research_direct_b = self.make_chat(
            RESEARCH_MODEL,
            DEEZX_FAST_B_BASE,
            timeout=300,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )
        self.research_routed = self.make_chat(
            "research",
            DEEZR_BASE,
            timeout=300,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )
        self.haiku_routed = self.make_chat(
            "haiku",
            DEEZR_BASE,
            timeout=300,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )

    @staticmethod
    def make_chat(
        model: str,
        base_url: str,
        timeout: int,
        extra_body: dict[str, Any] | None = None,
    ) -> ChatOpenAI:
        kwargs: dict[str, Any] = {
            "model": model,
            "base_url": base_url,
            "api_key": API_KEY,
            "temperature": 0,
            "timeout": timeout,
            "max_retries": 0,
        }
        if extra_body:
            kwargs["extra_body"] = extra_body
        return ChatOpenAI(**kwargs)

    def close(self) -> None:
        self.http.close()

    @staticmethod
    def require(condition: bool, message: str) -> None:
        if not condition:
            raise SmokeFailure(message)

    def get_json(self, url: str) -> Any:
        response = self.http.get(url)
        response.raise_for_status()
        return response.json()

    def multimodal_message(self, prompt: str) -> HumanMessage:
        return HumanMessage(
            content=[
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/png;base64,{self.red_square_b64}"
                    },
                },
                {"type": "text", "text": prompt},
            ]
        )

    def run_all(self) -> int:
        tests: list[tuple[str, Callable[[], None]]] = [
            ("topology-snapshot", self.test_topology_snapshot),
            ("coding-direct-chat", self.test_coding_direct_chat),
            ("coding-routed-chat", self.test_coding_routed_chat),
            ("coding-direct-bound-tool", self.test_coding_direct_bound_tool),
            ("coding-routed-bound-tool", self.test_coding_routed_bound_tool),
            ("thinking-direct-reasoning", self.test_thinking_direct_reasoning),
            ("thinking-direct-bound-tool", self.test_thinking_direct_bound_tool),
            ("thinking-direct-multimodal", self.test_thinking_direct_multimodal),
            ("thinking-routed-bound-tool", self.test_thinking_routed_bound_tool),
            ("thinking-deep-routed-reasoning", self.test_thinking_deep_routed_reasoning),
            ("thinking-routed-multimodal", self.test_thinking_routed_multimodal),
            ("thinking-direct-long-window", self.test_thinking_direct_long_window),
            ("research-direct-agent-tool", self.test_research_direct_agent_tool),
            ("research-b-direct-agent-tool", self.test_research_b_direct_agent_tool),
            ("research-routed-agent-tool", self.test_research_routed_agent_tool),
            ("haiku-routed-agent-tool", self.test_haiku_routed_agent_tool),
            ("research-direct-bound-tool", self.test_research_direct_bound_tool),
            ("research-b-direct-bound-tool", self.test_research_b_direct_bound_tool),
            ("research-direct-long-tool", self.test_research_direct_long_tool),
            ("research-b-direct-long-tool", self.test_research_b_direct_long_tool),
            ("research-routed-long-tool", self.test_research_routed_long_tool),
            ("haiku-routed-long-tool", self.test_haiku_routed_long_tool),
            ("router-parallel-burst", self.test_router_parallel_burst),
        ]

        failures: list[TestResult] = []
        for name, test_function in tests:
            started = time.perf_counter()
            try:
                test_function()
            except Exception as exc:  # noqa: BLE001
                duration = time.perf_counter() - started
                result = TestResult(
                    name=name,
                    duration_seconds=duration,
                    passed=False,
                    detail=str(exc),
                )
                failures.append(result)
                print(f"FAIL {name} {duration:.1f}s :: {exc}")
                if self.fail_fast:
                    break
            else:
                duration = time.perf_counter() - started
                print(f"PASS {name} {duration:.1f}s")

        if failures:
            print("LANGCHAIN_FLEET_SMOKE_FAILED")
            for failure in failures:
                print(f"DETAIL {failure.name} :: {failure.detail}")
            return 1

        print("LANGCHAIN_FLEET_SMOKE_OK")
        return 0

    def test_topology_snapshot(self) -> None:
        models = self.get_json(f"{DEEZR_BASE}/models")
        model_ids = {entry["id"] for entry in models["data"]}
        self.require(
            {"thinking", "thinking-deep", "coding", "research"}.issubset(model_ids),
            f"router model inventory changed: {sorted(model_ids)!r}",
        )

        props = self.get_json(f"{DEEZ1_ROOT}/props")
        n_ctx = props.get("default_generation_settings", {}).get("n_ctx", 0)
        alias = props.get("model_alias")
        self.require(n_ctx >= 262144, f"expected deez1 n_ctx >= 262144, got {n_ctx}")
        self.require(alias == CODING_MODEL, f"unexpected deez1 alias {alias!r}")

        slots = self.get_json(f"{DEEZ1_ROOT}/slots")
        self.require(len(slots) == 4, f"expected 4 deez1 slots, got {len(slots)}")
        self.require(
            all(slot.get("n_ctx") == 262144 for slot in slots),
            f"unexpected deez1 slot windows {slots!r}",
        )

        for url in [
            f"{DEEZ2_ROOT}/props",
            f"{DEEZ2_B_ROOT}/props",
        ]:
            props = self.get_json(url)
            n_ctx = props.get("default_generation_settings", {}).get("n_ctx", 0)
            alias = props.get("model_alias")
            self.require(n_ctx >= 262144, f"expected deez2 n_ctx >= 262144, got {n_ctx}")
            self.require(alias == THINKING_MODEL, f"unexpected deez2 alias {alias!r}")

        for url in [
            f"{DEEZ2_ROOT}/slots",
            f"{DEEZ2_B_ROOT}/slots",
        ]:
            slots = self.get_json(url)
            self.require(len(slots) == 2, f"expected 2 Gemma slots at {url}, got {len(slots)}")
            self.require(
                all(slot.get("n_ctx") == 262144 for slot in slots),
                f"unexpected Gemma slot windows at {url}: {slots!r}",
            )

        for url in [
            "http://192.168.1.161:8000/props",
            "http://192.168.1.161:8001/props",
        ]:
            props = self.get_json(url)
            n_ctx = props.get("default_generation_settings", {}).get("n_ctx", 0)
            alias = props.get("model_alias")
            self.require(n_ctx >= 131072, f"expected deezx n_ctx >= 131072, got {n_ctx}")
            self.require(alias == RESEARCH_MODEL, f"unexpected deezx alias {alias!r}")

        for url in [
            "http://192.168.1.95:8010/health",
            "http://192.168.1.114:8000/health",
            "http://192.168.1.114:8001/health",
            "http://192.168.1.161:8000/health",
            "http://192.168.1.161:8001/health",
            "http://192.168.1.85:4000/health/liveliness",
        ]:
            response = self.http.get(url)
            response.raise_for_status()

    def test_coding_direct_chat(self) -> None:
        message = self.coding_direct.invoke(
            [HumanMessage(content="Reply with exactly one token: 42")]
        )
        self.require("42" in str(message.content), f"unexpected coding direct reply {message.content!r}")

    def test_coding_routed_chat(self) -> None:
        message = self.coding_routed.invoke(
            [HumanMessage(content="Reply with exactly one token: 42")]
        )
        self.require("42" in str(message.content), f"unexpected coding routed reply {message.content!r}")

    def test_coding_direct_bound_tool(self) -> None:
        self.run_bound_tool_smoke(self.coding_direct, min_prompt_tokens=200, expect_clean_content=False)

    def test_coding_routed_bound_tool(self) -> None:
        self.run_bound_tool_smoke(self.coding_routed, min_prompt_tokens=200)

    def test_thinking_direct_reasoning(self) -> None:
        message = self.thinking_direct_reasoning.invoke(
            [HumanMessage(content="Which is greater, 9.11 or 9.8? Answer briefly.")]
        )
        content = str(message.content).lower()
        self.require("9.8" in content, f"unexpected reasoning answer {message.content!r}")

    def test_thinking_direct_bound_tool(self) -> None:
        self.run_bound_tool_smoke(self.thinking_direct, min_prompt_tokens=70)

    def test_thinking_direct_multimodal(self) -> None:
        message = self.thinking_direct.invoke(
            [self.multimodal_message("What color is this square? Answer with one word.")]
        )
        content = str(message.content).lower()
        self.require("red" in content, f"unexpected multimodal direct answer {message.content!r}")

    def test_thinking_routed_bound_tool(self) -> None:
        self.run_bound_tool_smoke(self.thinking_routed, min_prompt_tokens=70)

    def test_thinking_deep_routed_reasoning(self) -> None:
        response = self.http.post(
            f"{DEEZR_BASE}/chat/completions",
            json={
                "model": "thinking-deep",
                "messages": [
                    {
                        "role": "user",
                        "content": "Which is greater, 9.11 or 9.8? Answer briefly.",
                    }
                ],
                "temperature": 0,
                "max_tokens": 256,
            },
        )
        response.raise_for_status()
        message = response.json()["choices"][0]["message"]
        self.require(
            message.get("reasoning_content") is not None,
            f"expected reasoning content from thinking-deep, got {message!r}",
        )

    def test_thinking_routed_multimodal(self) -> None:
        message = self.thinking_routed.invoke(
            [self.multimodal_message("What color is this square? Answer with one word.")]
        )
        content = str(message.content).lower()
        self.require("red" in content, f"unexpected multimodal routed answer {message.content!r}")

    def test_thinking_direct_long_window(self) -> None:
        filler = "alpha " * 40000
        message = self.thinking_direct.invoke(
            [
                HumanMessage(
                    content=f"{filler}\n\nThe previous text is filler. Reply with exactly one word: ready."
                )
            ]
        )
        content = str(message.content).strip().lower().rstrip(".")
        prompt_tokens = message.response_metadata.get("token_usage", {}).get("prompt_tokens", 0)
        self.require(content == "ready", f"unexpected long-window Gemma reply {message.content!r}")
        self.require(prompt_tokens > 39000, f"expected long prompt token count, got {prompt_tokens}")

    def test_research_direct_agent_tool(self) -> None:
        self.run_agent_tool_smoke(self.research_direct)

    def test_research_b_direct_agent_tool(self) -> None:
        self.run_agent_tool_smoke(self.research_direct_b)

    def test_research_routed_agent_tool(self) -> None:
        self.run_agent_tool_smoke(self.research_routed)

    def test_haiku_routed_agent_tool(self) -> None:
        self.run_agent_tool_smoke(self.haiku_routed)

    def run_agent_tool_smoke(self, llm: ChatOpenAI) -> None:
        executor = make_agent_executor(llm)
        result = executor.invoke(
            {
                "input": "Use get_time with timezone UTC and report the returned marker exactly.",
            }
        )
        self.assert_agent_tool_result(result)

    def assert_agent_tool_result(self, result: dict[str, Any]) -> None:
        steps = result.get("intermediate_steps", [])
        self.require(len(steps) >= 1, "agent never executed a tool")
        first_action, observation = steps[0]
        self.require(first_action.tool == "get_time", f"unexpected tool {first_action.tool!r}")
        self.require(
            "LANGCHAIN_SMOKE_TIME[UTC]" in observation,
            f"unexpected tool observation {observation!r}",
        )

    def test_research_direct_bound_tool(self) -> None:
        self.run_bound_tool_smoke(self.research_direct, min_prompt_tokens=RESEARCH_SHORT_TOOL_MIN_PROMPT_TOKENS)

    def test_research_b_direct_bound_tool(self) -> None:
        self.run_bound_tool_smoke(self.research_direct_b, min_prompt_tokens=RESEARCH_SHORT_TOOL_MIN_PROMPT_TOKENS)

    def test_research_direct_long_tool(self) -> None:
        self.run_bound_tool_smoke(
            self.research_direct,
            min_prompt_tokens=RESEARCH_LONG_TOOL_MIN_PROMPT_TOKENS,
            filler_words=RESEARCH_LONG_TOOL_FILLER_WORDS,
        )

    def test_research_b_direct_long_tool(self) -> None:
        self.run_bound_tool_smoke(
            self.research_direct_b,
            min_prompt_tokens=RESEARCH_LONG_TOOL_MIN_PROMPT_TOKENS,
            filler_words=RESEARCH_LONG_TOOL_FILLER_WORDS,
        )

    def test_research_routed_long_tool(self) -> None:
        self.run_bound_tool_smoke(
            self.research_routed,
            min_prompt_tokens=RESEARCH_LONG_TOOL_MIN_PROMPT_TOKENS,
            filler_words=RESEARCH_LONG_TOOL_FILLER_WORDS,
        )

    def test_haiku_routed_long_tool(self) -> None:
        self.run_bound_tool_smoke(
            self.haiku_routed,
            min_prompt_tokens=RESEARCH_LONG_TOOL_MIN_PROMPT_TOKENS,
            filler_words=RESEARCH_LONG_TOOL_FILLER_WORDS,
        )

    def run_bound_tool_smoke(
        self,
        llm: ChatOpenAI,
        min_prompt_tokens: int,
        filler_words: int = 0,
        expect_clean_content: bool = True,
    ) -> None:
        llm_with_tools = llm.bind_tools([get_time])
        content = "Call get_time with timezone UTC. Do not answer with plain text."
        if filler_words:
            filler = "alpha " * filler_words
            content = f"{filler}\n\n{content}"
        message = llm_with_tools.invoke([HumanMessage(content=content)])
        self.assert_tool_call(
            message,
            min_prompt_tokens=min_prompt_tokens,
            expect_clean_content=expect_clean_content,
        )

    def assert_tool_call(
        self,
        message: Any,
        min_prompt_tokens: int,
        expect_clean_content: bool,
    ) -> None:
        tool_calls = getattr(message, "tool_calls", [])
        self.require(tool_calls, "expected at least one tool call")
        content = str(getattr(message, "content", "") or "")
        if expect_clean_content:
            self.require("<think>" not in content, f"raw think tags leaked in content {content!r}")
        first_call = tool_calls[0]
        self.require(first_call["name"] == "get_time", f"unexpected tool call {first_call!r}")
        self.require(
            first_call["args"].get("timezone") == "UTC",
            f"unexpected tool args {first_call!r}",
        )
        prompt_tokens = message.response_metadata.get("token_usage", {}).get("prompt_tokens", 0)
        self.require(
            prompt_tokens >= min_prompt_tokens,
            f"expected prompt_tokens >= {min_prompt_tokens}, got {prompt_tokens}",
        )

    def test_router_parallel_burst(self) -> None:
        def coding_call() -> str:
            self.run_bound_tool_smoke(self.coding_routed, min_prompt_tokens=200)
            return "coding"

        def thinking_call() -> str:
            self.run_bound_tool_smoke(self.thinking_routed, min_prompt_tokens=70)
            return "thinking"

        def research_call() -> str:
            self.run_bound_tool_smoke(
                self.research_routed,
                min_prompt_tokens=RESEARCH_SHORT_TOOL_MIN_PROMPT_TOKENS,
            )
            return "research"

        def haiku_call() -> str:
            self.run_bound_tool_smoke(
                self.haiku_routed,
                min_prompt_tokens=RESEARCH_SHORT_TOOL_MIN_PROMPT_TOKENS,
            )
            return "haiku"

        tasks = [coding_call, thinking_call, research_call, haiku_call] * 3
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
            futures = [executor.submit(task) for task in tasks]
            completed = [future.result(timeout=240) for future in futures]
        self.require(len(completed) == len(tasks), "parallel burst lost work")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fail-fast", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    runner = LangChainFleetSmoke(fail_fast=args.fail_fast)
    try:
        return runner.run_all()
    finally:
        runner.close()


if __name__ == "__main__":
    raise SystemExit(main())