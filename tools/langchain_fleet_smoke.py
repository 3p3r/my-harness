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
from langchain_openai import ChatOpenAI, OpenAIEmbeddings


API_KEY = "none"
DEEZ1_BASE = "http://192.168.1.95:8010/v1"
DEEZ2_BASE = "http://192.168.1.114:8000/v1"
DEEZX_BASE = "http://192.168.1.161:8000/v1"
DEEZX_EMBED_BASE = "http://192.168.1.161:8001/v1"
DEEZX_RERANK_BASE = "http://192.168.1.161:8002"
DEEZR_BASE = "http://192.168.1.85:4000/v1"
DEEZR_RERANK_BASE = "http://192.168.1.85:4000"

CODING_MODEL = "Qwen3.6-35B-A3B-Q8_0.gguf"
THINKING_MODEL = "TrevorJS/gemma-4-26B-A4B-it-uncensored"
RESEARCH_MODEL = "Qwen/Qwen3.6-35B-A3B"
EMBED_MODEL = "Qwen/Qwen3-Embedding-4B"
RERANK_MODEL = "BAAI/bge-reranker-v2-m3"


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


def max_abs_delta(left: list[float], right: list[float]) -> float:
    return max(abs(left_value - right_value) for left_value, right_value in zip(left, right))


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

        self.coding_direct = self.make_chat(CODING_MODEL, DEEZ1_BASE, timeout=120)
        self.coding_routed = self.make_chat("coding", DEEZR_BASE, timeout=120)

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

        self.research_direct = self.make_chat(RESEARCH_MODEL, DEEZX_BASE, timeout=180)
        self.research_routed = self.make_chat("research", DEEZR_BASE, timeout=180)

        self.embed_direct = OpenAIEmbeddings(
            model=EMBED_MODEL,
            base_url=DEEZX_EMBED_BASE,
            api_key=API_KEY,
            max_retries=0,
            request_timeout=120,
        )
        self.embed_routed = OpenAIEmbeddings(
            model="embedding",
            base_url=DEEZR_BASE,
            api_key=API_KEY,
            max_retries=0,
            request_timeout=120,
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

    def routed_rerank(self, query: str, documents: list[str]) -> dict[str, Any]:
        response = self.http.post(
            f"{DEEZR_RERANK_BASE}/rerank",
            json={"model": "rerank", "query": query, "documents": documents},
            timeout=60,
        )
        response.raise_for_status()
        return response.json()

    def direct_rerank(self, query: str, texts: list[str]) -> list[dict[str, Any]]:
        response = self.http.post(
            f"{DEEZX_RERANK_BASE}/rerank",
            json={"query": query, "texts": texts},
            timeout=60,
        )
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
            ("thinking-direct-reasoning", self.test_thinking_direct_reasoning),
            ("thinking-direct-multimodal", self.test_thinking_direct_multimodal),
            ("thinking-routed-multimodal", self.test_thinking_routed_multimodal),
            ("thinking-direct-long-window", self.test_thinking_direct_long_window),
            ("research-direct-agent-tool", self.test_research_direct_agent_tool),
            ("research-routed-agent-tool", self.test_research_routed_agent_tool),
            ("research-direct-bound-tool", self.test_research_direct_bound_tool),
            ("research-direct-long-tool", self.test_research_direct_long_tool),
            ("research-routed-long-tool", self.test_research_routed_long_tool),
            ("embeddings-direct-similarity", self.test_embeddings_direct_similarity),
            ("embeddings-routed-similarity", self.test_embeddings_routed_similarity),
            ("rerank-direct-native", self.test_rerank_direct_native),
            ("rerank-routed-litellm", self.test_rerank_routed_litellm),
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
        self.require(len(models["data"]) == 9, "router model inventory changed")

        props = self.get_json("http://192.168.1.161:8000/props")
        n_ctx = props.get("default_generation_settings", {}).get("n_ctx", 0)
        alias = props.get("model_alias")
        self.require(n_ctx >= 32768, f"expected deezx n_ctx >= 32768, got {n_ctx}")
        self.require(alias == RESEARCH_MODEL, f"unexpected deezx alias {alias!r}")

        for url in [
            "http://192.168.1.95:8010/health",
            "http://192.168.1.114:8000/health",
            "http://192.168.1.161:8000/health",
            "http://192.168.1.161:8001/health",
            "http://192.168.1.161:8002/health",
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

    def test_thinking_direct_reasoning(self) -> None:
        message = self.thinking_direct_reasoning.invoke(
            [HumanMessage(content="Which is greater, 9.11 or 9.8? Answer briefly.")]
        )
        content = str(message.content).lower()
        self.require("9.8" in content, f"unexpected reasoning answer {message.content!r}")

    def test_thinking_direct_multimodal(self) -> None:
        message = self.thinking_direct.invoke(
            [self.multimodal_message("What color is this square? Answer with one word.")]
        )
        content = str(message.content).lower()
        self.require("red" in content, f"unexpected multimodal direct answer {message.content!r}")

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
        executor = make_agent_executor(self.research_direct)
        result = executor.invoke(
            {
                "input": "Use get_time with timezone UTC and report the returned marker exactly.",
            }
        )
        self.assert_agent_tool_result(result)

    def test_research_routed_agent_tool(self) -> None:
        executor = make_agent_executor(self.research_routed)
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
        llm_with_tools = self.research_direct.bind_tools([get_time])
        message = llm_with_tools.invoke(
            [
                HumanMessage(
                    content="Call get_time with timezone UTC. Do not answer with plain text."
                )
            ]
        )
        self.assert_tool_call(message, min_prompt_tokens=200)

    def test_research_direct_long_tool(self) -> None:
        llm_with_tools = self.research_direct.bind_tools([get_time])
        filler = "alpha " * 28000
        message = llm_with_tools.invoke(
            [
                HumanMessage(
                    content=f"{filler}\n\nCall get_time with timezone UTC. Do not answer with plain text."
                )
            ]
        )
        self.assert_tool_call(message, min_prompt_tokens=27000)

    def test_research_routed_long_tool(self) -> None:
        llm_with_tools = self.research_routed.bind_tools([get_time])
        filler = "alpha " * 28000
        message = llm_with_tools.invoke(
            [
                HumanMessage(
                    content=f"{filler}\n\nCall get_time with timezone UTC. Do not answer with plain text."
                )
            ]
        )
        self.assert_tool_call(message, min_prompt_tokens=27000)

    def assert_tool_call(self, message: Any, min_prompt_tokens: int) -> None:
        tool_calls = getattr(message, "tool_calls", [])
        self.require(tool_calls, "expected at least one tool call")
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

    def test_embeddings_direct_similarity(self) -> None:
        documents = ["gpu inference path", "gpu inference path"]
        document_vectors = self.embed_direct.embed_documents(documents)
        query_vector_first = self.embed_direct.embed_query("gpu inference path")
        query_vector_second = self.embed_direct.embed_query("gpu inference path")
        self.require(len(document_vectors) == 2, "expected two direct embedding vectors")
        self.require(len(document_vectors[0]) > 1000, "unexpected direct embedding dimension")
        self.require(
            max_abs_delta(document_vectors[0], document_vectors[1]) == 0.0,
            "direct embeddings for identical text were not identical",
        )
        self.require(
            max_abs_delta(query_vector_first, query_vector_second) == 0.0,
            "direct query embeddings for identical text were not identical",
        )

    def test_embeddings_routed_similarity(self) -> None:
        documents = ["gpu inference path", "gpu inference path"]
        document_vectors = self.embed_routed.embed_documents(documents)
        query_vector_first = self.embed_routed.embed_query("gpu inference path")
        query_vector_second = self.embed_routed.embed_query("gpu inference path")
        direct_document_vectors = self.embed_direct.embed_documents(documents)
        direct_query_vector = self.embed_direct.embed_query("gpu inference path")
        self.require(len(document_vectors) == 2, "expected two routed embedding vectors")
        self.require(len(document_vectors[0]) > 1000, "unexpected routed embedding dimension")
        self.require(
            max_abs_delta(document_vectors[0], document_vectors[1]) == 0.0,
            "routed embeddings for identical text were not identical",
        )
        self.require(
            max_abs_delta(query_vector_first, query_vector_second) == 0.0,
            "routed query embeddings for identical text were not identical",
        )
        self.require(
            max_abs_delta(document_vectors[0], direct_document_vectors[0]) < 1e-6,
            "direct and routed batched document embeddings diverged unexpectedly",
        )
        self.require(
            max_abs_delta(document_vectors[1], direct_document_vectors[1]) < 1e-6,
            "direct and routed document embeddings diverged unexpectedly",
        )
        self.require(
            max_abs_delta(query_vector_first, direct_query_vector) < 1e-6,
            "direct and routed query embeddings diverged unexpectedly",
        )

    def test_rerank_direct_native(self) -> None:
        results = self.direct_rerank(
            "gpu acceleration",
            ["This machine runs GPU inference.", "This machine waters plants."],
        )
        self.require(len(results) == 2, f"unexpected direct rerank payload {results!r}")
        self.require(results[0]["index"] == 0, f"unexpected direct top rerank result {results!r}")
        self.require(results[0]["score"] > results[1]["score"], f"unexpected direct scores {results!r}")

    def test_rerank_routed_litellm(self) -> None:
        response = self.routed_rerank(
            "gpu acceleration",
            ["This machine runs GPU inference.", "This machine waters plants."],
        )
        results = response.get("results", [])
        self.require(len(results) == 2, f"unexpected routed rerank payload {response!r}")
        self.require(results[0]["index"] == 0, f"unexpected routed top rerank result {response!r}")
        self.require(
            results[0]["relevance_score"] > results[1]["relevance_score"],
            f"unexpected routed scores {response!r}",
        )

    def test_router_parallel_burst(self) -> None:
        def coding_call() -> str:
            reply = self.coding_routed.invoke([HumanMessage(content="Reply with exactly one token: 42")])
            self.require("42" in str(reply.content), f"parallel coding reply {reply.content!r}")
            return "coding"

        def research_call() -> str:
            llm_with_tools = self.research_routed.bind_tools([get_time])
            reply = llm_with_tools.invoke(
                [
                    HumanMessage(
                        content="Call get_time with timezone UTC. Do not answer with plain text."
                    )
                ]
            )
            self.assert_tool_call(reply, min_prompt_tokens=200)
            return "research"

        def embed_call() -> str:
            vector = self.embed_routed.embed_query("parallel embedding smoke")
            self.require(len(vector) > 1000, "parallel embedding dimension too small")
            return "embedding"

        def rerank_call() -> str:
            response = self.routed_rerank(
                "gpu acceleration",
                ["This machine runs GPU inference.", "This machine waters plants."],
            )
            self.require(response["results"][0]["index"] == 0, f"parallel rerank response {response!r}")
            return "rerank"

        tasks = [coding_call, research_call, embed_call, rerank_call] * 2
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
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