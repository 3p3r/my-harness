#!/usr/bin/env python3

from __future__ import annotations

import argparse
import concurrent.futures
import json
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


class BenchmarkError(RuntimeError):
    pass


@dataclass(frozen=True)
class EndpointSpec:
    node: str
    base_url: str
    extra_body: dict[str, Any]


@dataclass(frozen=True)
class SlotTarget:
    node: str
    endpoint: str
    base_url: str
    model: str
    slot_id: int
    extra_body: dict[str, Any]

    @property
    def label(self) -> str:
        return f"{self.endpoint}/slot{self.slot_id}"


@dataclass(frozen=True)
class SlotSample:
    node: str
    endpoint: str
    slot_id: int
    completion_tokens: int
    predicted_tokens: int
    predicted_tps: float
    predicted_ms: float
    wall_seconds: float


@dataclass(frozen=True)
class NodeRound:
    node: str
    slots: int
    total_completion_tokens: int
    total_predicted_tokens: int
    summed_decode_tps: float
    wall_tps: float
    wall_seconds: float


ENDPOINTS = [
    EndpointSpec(
        node="deez1",
        base_url="http://192.168.1.95:8010/v1",
        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
    ),
    EndpointSpec(
        node="deez2",
        base_url="http://192.168.1.114:8000/v1",
        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
    ),
    EndpointSpec(
        node="deez2",
        base_url="http://192.168.1.114:8001/v1",
        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
    ),
    EndpointSpec(
        node="deezx",
        base_url="http://192.168.1.161:8000/v1",
        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
    ),
    EndpointSpec(
        node="deezx",
        base_url="http://192.168.1.161:8001/v1",
        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
    ),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Measure direct fleet throughput from the live llama.cpp chat endpoints. "
            "Reports per-slot decode speed and per-node aggregate throughput under full slot saturation."
        )
    )
    parser.add_argument("--warmups", type=int, default=1, help="Warmup requests per slot before measurement")
    parser.add_argument("--slot-runs", type=int, default=3, help="Measured isolated requests per slot")
    parser.add_argument("--node-runs", type=int, default=3, help="Measured full-node saturation rounds")
    parser.add_argument("--max-tokens", type=int, default=96, help="Requested max completion tokens per run")
    parser.add_argument("--timeout", type=float, default=180.0, help="HTTP timeout per request in seconds")
    parser.add_argument(
        "--nodes",
        nargs="*",
        choices=sorted({spec.node for spec in ENDPOINTS}),
        help="Optional subset of nodes to benchmark",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of tables")
    return parser.parse_args()


def get_json(url: str, timeout: float) -> Any:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise BenchmarkError(f"GET {url} failed with HTTP {exc.code}: {detail[:400]}") from exc
    except urllib.error.URLError as exc:
        raise BenchmarkError(f"GET {url} failed: {exc}") from exc


def post_json(url: str, payload: dict[str, Any], timeout: float) -> tuple[dict[str, Any], float]:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise BenchmarkError(f"POST {url} failed with HTTP {exc.code}: {detail[:400]}") from exc
    except urllib.error.URLError as exc:
        raise BenchmarkError(f"POST {url} failed: {exc}") from exc

    elapsed = time.perf_counter() - started
    try:
        return json.loads(body), elapsed
    except json.JSONDecodeError as exc:
        preview = body.decode("utf-8", errors="replace")
        raise BenchmarkError(f"POST {url} returned invalid JSON: {preview[:400]}") from exc


def endpoint_label(base_url: str) -> str:
    parsed = urllib.parse.urlparse(base_url)
    return parsed.netloc


def discover_targets(specs: list[EndpointSpec], timeout: float) -> dict[str, list[SlotTarget]]:
    targets_by_node: dict[str, list[SlotTarget]] = {}
    for spec in specs:
        models = get_json(f"{spec.base_url}/models", timeout)
        model = models["data"][0]["id"]
        root_url = spec.base_url.removesuffix("/v1")
        slots = get_json(f"{root_url}/slots", timeout)
        if not isinstance(slots, list) or not slots:
            raise BenchmarkError(f"No slots discovered at {root_url}/slots")

        targets_by_node.setdefault(spec.node, [])
        for slot in slots:
            slot_id = slot.get("id")
            if not isinstance(slot_id, int):
                raise BenchmarkError(f"Unexpected slot payload at {root_url}/slots: {slot!r}")
            targets_by_node[spec.node].append(
                SlotTarget(
                    node=spec.node,
                    endpoint=endpoint_label(spec.base_url),
                    base_url=spec.base_url,
                    model=model,
                    slot_id=slot_id,
                    extra_body=spec.extra_body,
                )
            )
    for node_targets in targets_by_node.values():
        node_targets.sort(key=lambda target: (target.endpoint, target.slot_id))
    return targets_by_node


def make_payload(target: SlotTarget, nonce: str, max_tokens: int) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": target.model,
        "messages": [
            {
                "role": "user",
                "content": (
                    "Benchmark run "
                    f"{nonce}. Reply with exactly 64 ok tokens separated by single spaces. "
                    "Do not include any other text."
                ),
            }
        ],
        "temperature": 0,
        "max_tokens": max_tokens,
        "cache_prompt": False,
        "id_slot": target.slot_id,
    }
    payload.update(target.extra_body)
    return payload


def run_slot_request(target: SlotTarget, timeout: float, max_tokens: int, nonce: str) -> SlotSample:
    response, wall_seconds = post_json(
        f"{target.base_url}/chat/completions",
        make_payload(target, nonce, max_tokens),
        timeout,
    )
    timings = response.get("timings") or {}
    usage = response.get("usage") or {}
    predicted_tps = float(timings.get("predicted_per_second") or 0.0)
    predicted_tokens = int(timings.get("predicted_n") or 0)
    predicted_ms = float(timings.get("predicted_ms") or 0.0)
    completion_tokens = int(usage.get("completion_tokens") or predicted_tokens)

    if predicted_tps <= 0 or predicted_tokens <= 0 or completion_tokens <= 0:
        raise BenchmarkError(
            f"Missing timing data for {target.label}: timings={timings!r} usage={usage!r}"
        )

    return SlotSample(
        node=target.node,
        endpoint=target.endpoint,
        slot_id=target.slot_id,
        completion_tokens=completion_tokens,
        predicted_tokens=predicted_tokens,
        predicted_tps=predicted_tps,
        predicted_ms=predicted_ms,
        wall_seconds=wall_seconds,
    )


def run_slot_benchmark(
    targets_by_node: dict[str, list[SlotTarget]],
    timeout: float,
    max_tokens: int,
    warmups: int,
    slot_runs: int,
) -> dict[str, list[SlotSample]]:
    samples_by_label: dict[str, list[SlotSample]] = {}
    for node_targets in targets_by_node.values():
        for target in node_targets:
            for warmup_index in range(warmups):
                run_slot_request(target, timeout, max_tokens, f"warmup-{warmup_index}-{target.label}")
            samples_by_label[target.label] = []
            for run_index in range(slot_runs):
                sample = run_slot_request(target, timeout, max_tokens, f"slot-{run_index}-{target.label}")
                samples_by_label[target.label].append(sample)
    return samples_by_label


def run_node_round(targets: list[SlotTarget], timeout: float, max_tokens: int, round_index: int) -> NodeRound:
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(targets)) as executor:
        started = time.perf_counter()
        futures = [
            executor.submit(
                run_slot_request,
                target,
                timeout,
                max_tokens,
                f"node-{round_index}-{target.endpoint}-slot{target.slot_id}",
            )
            for target in targets
        ]
        samples = [future.result() for future in futures]
        wall_seconds = time.perf_counter() - started

    total_completion_tokens = sum(sample.completion_tokens for sample in samples)
    total_predicted_tokens = sum(sample.predicted_tokens for sample in samples)
    summed_decode_tps = sum(sample.predicted_tps for sample in samples)
    wall_tps = total_completion_tokens / wall_seconds

    return NodeRound(
        node=targets[0].node,
        slots=len(targets),
        total_completion_tokens=total_completion_tokens,
        total_predicted_tokens=total_predicted_tokens,
        summed_decode_tps=summed_decode_tps,
        wall_tps=wall_tps,
        wall_seconds=wall_seconds,
    )


def run_node_benchmark(
    targets_by_node: dict[str, list[SlotTarget]],
    timeout: float,
    max_tokens: int,
    node_runs: int,
) -> dict[str, list[NodeRound]]:
    rounds_by_node: dict[str, list[NodeRound]] = {}
    for node, targets in targets_by_node.items():
        rounds_by_node[node] = [
            run_node_round(targets, timeout, max_tokens, round_index)
            for round_index in range(node_runs)
        ]
    return rounds_by_node


def mean(values: list[float]) -> float:
    return statistics.fmean(values) if values else 0.0


def summarize_slots(samples_by_label: dict[str, list[SlotSample]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for label in sorted(samples_by_label):
        samples = samples_by_label[label]
        first = samples[0]
        predicted_tps = [sample.predicted_tps for sample in samples]
        completion_tokens = [sample.completion_tokens for sample in samples]
        rows.append(
            {
                "node": first.node,
                "endpoint": first.endpoint,
                "slot": first.slot_id,
                "avg_tps": mean(predicted_tps),
                "min_tps": min(predicted_tps),
                "max_tps": max(predicted_tps),
                "avg_completion_tokens": mean(completion_tokens),
            }
        )
    return rows


def summarize_nodes(rounds_by_node: dict[str, list[NodeRound]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for node in sorted(rounds_by_node):
        rounds = rounds_by_node[node]
        rows.append(
            {
                "node": node,
                "slots": rounds[0].slots,
                "avg_decode_tps": mean([round_.summed_decode_tps for round_ in rounds]),
                "min_decode_tps": min(round_.summed_decode_tps for round_ in rounds),
                "max_decode_tps": max(round_.summed_decode_tps for round_ in rounds),
                "avg_wall_tps": mean([round_.wall_tps for round_ in rounds]),
                "avg_round_seconds": mean([round_.wall_seconds for round_ in rounds]),
            }
        )
    return rows


def format_value(value: Any) -> str:
    if isinstance(value, float):
        return f"{value:.2f}"
    return str(value)


def render_table(headers: list[str], rows: list[list[Any]]) -> str:
    formatted_rows = [[format_value(cell) for cell in row] for row in rows]
    widths = [len(header) for header in headers]
    for row in formatted_rows:
        for index, cell in enumerate(row):
            widths[index] = max(widths[index], len(cell))

    def render_row(values: list[str]) -> str:
        return "  ".join(value.ljust(widths[index]) for index, value in enumerate(values))

    separator = "  ".join("-" * width for width in widths)
    lines = [render_row(headers), separator]
    lines.extend(render_row(row) for row in formatted_rows)
    return "\n".join(lines)


def render_text(
    args: argparse.Namespace,
    targets_by_node: dict[str, list[SlotTarget]],
    node_rows: list[dict[str, Any]],
    slot_rows: list[dict[str, Any]],
) -> str:
    node_table = render_table(
        ["node", "slots", "avg_decode_tps", "min", "max", "avg_wall_tps", "avg_round_s"],
        [
            [
                row["node"],
                row["slots"],
                row["avg_decode_tps"],
                row["min_decode_tps"],
                row["max_decode_tps"],
                row["avg_wall_tps"],
                row["avg_round_seconds"],
            ]
            for row in node_rows
        ],
    )
    slot_table = render_table(
        ["node", "endpoint", "slot", "avg_tps", "min", "max", "avg_tokens"],
        [
            [
                row["node"],
                row["endpoint"],
                row["slot"],
                row["avg_tps"],
                row["min_tps"],
                row["max_tps"],
                row["avg_completion_tokens"],
            ]
            for row in slot_rows
        ],
    )

    lines = [
        "Fleet throughput benchmark",
        (
            "Method: direct /v1/chat/completions with temperature=0, cache_prompt=false, "
            f"max_tokens={args.max_tokens}, warmups={args.warmups}, "
            f"slot_runs={args.slot_runs}, node_runs={args.node_runs}."
        ),
        (
            "Node throughput is the sum of server-reported decode TPS from one concurrent request per slot. "
            "avg_wall_tps is end-to-end completion tokens divided by wall time for the same rounds."
        ),
        "",
        "Node throughput",
        node_table,
        "",
        "Slot throughput",
        slot_table,
        "",
        "Discovered topology",
    ]
    for node in sorted(targets_by_node):
        targets = targets_by_node[node]
        endpoints = sorted({target.endpoint for target in targets})
        lines.append(f"- {node}: {len(targets)} slots across {', '.join(endpoints)}")
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    selected_nodes = set(args.nodes or [spec.node for spec in ENDPOINTS])
    specs = [spec for spec in ENDPOINTS if spec.node in selected_nodes]
    targets_by_node = discover_targets(specs, args.timeout)
    slot_samples = run_slot_benchmark(
        targets_by_node,
        timeout=args.timeout,
        max_tokens=args.max_tokens,
        warmups=args.warmups,
        slot_runs=args.slot_runs,
    )
    node_rounds = run_node_benchmark(
        targets_by_node,
        timeout=args.timeout,
        max_tokens=args.max_tokens,
        node_runs=args.node_runs,
    )

    node_rows = summarize_nodes(node_rounds)
    slot_rows = summarize_slots(slot_samples)
    if args.json:
        print(
            json.dumps(
                {
                    "method": {
                        "endpoint": "/v1/chat/completions",
                        "temperature": 0,
                        "cache_prompt": False,
                        "max_tokens": args.max_tokens,
                        "warmups": args.warmups,
                        "slot_runs": args.slot_runs,
                        "node_runs": args.node_runs,
                    },
                    "nodes": node_rows,
                    "slots": slot_rows,
                },
                indent=2,
            )
        )
    else:
        print(render_text(args, targets_by_node, node_rows, slot_rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())