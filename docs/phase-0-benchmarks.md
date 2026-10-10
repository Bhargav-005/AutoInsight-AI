# Phase 0 hardware and local-model results

## Provenance and acceptance

These measurements were supplied by the project owner and accepted as sufficient to begin Phase 1. They were not rerun by the Checkpoint A implementation. The measurement date, exact prompt, request body, warm/cold state and repeat count were not supplied; do not invent them or interpret this observation as a statistical reliability benchmark.

## Reported hardware and environment

| Item | Reported configuration |
| --- | --- |
| Operating system | Windows 11 |
| CPU | Intel Core i5, 13th generation HX |
| RAM | 24 GB |
| GPU | NVIDIA RTX 3050, 6 GB VRAM |
| Model | `qwen3.5:4b-q4_K_M` |
| Model storage | `D:\OllamaModels` |
| Project root | `E:\FSI` |

## User-reported observations

| Check | Observed result |
| --- | --- |
| GPU execution | 100% GPU according to `ollama ps` |
| GPU memory usage | 3887 MiB |
| Thinking-disabled analytical tool selection | 1.28 seconds |
| Selected analytical tool | `run_aggregate`, correct for the tested request |
| Strict JSON-schema API test | Succeeded |
| Unsupported destructive request | Returned `selected_tool: none` |

These results support the initial local-model choice. They do not prove arbitrary prompt safety, sustained latency, full-dataset capacity or correctness across all seven future roles. No additional inference is required for Checkpoint A.

## Later verification

Phase 7 will evaluate typed tool selection, unsafe requests, malformed responses, ambiguity, timeouts, step/replan budgets and evidence validation. Phase 9 will measure repeated workload latency, failure rates, RAM/VRAM and integration/security behavior. Preserve prompts, model identity, request settings, sample counts and failures when collecting those results.
