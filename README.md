# HIM safety & security notes

Field notes from running **HIM (Human Intelligence Mining)**, a live skill-game product on Solana mainnet where people stake real money on answering questions, and where the obvious attacker is a frontier model.

Author: **Mehmet Tokgöz**, Founder & CEO, Abrakadabra Games · [him.finance](https://him.finance) · [LinkedIn](https://www.linkedin.com/in/mehmet-tokg%C3%B6z-6ab01b10a)

Each note asks a narrow question, measures it on our own system and reports the result, including when the result is bad for us.

| # | Note | One-line result |
|---|---|---|
| 01 | [Can a cheap LLM play a human-verification game?](01-llm-vs-human-verification-game.md) | Claude Haiku 5.5 answered **98.1%** of 260 production questions at a median **652 ms**. Our game mechanics did not stop it, so we changed the public claim from "bot-proof" to "measured and monitored". |
| 02 | [Motion-defined text: a defense, then an adaptive attack](02-motion-defined-text-adaptive-attack.md) | Frame-based vision attacks fell to **chance (25–38%)** for Haiku 5.5 and Sonnet 5.5. A ~90-line temporal decoder recovered the text (**AUC 0.97**) and Sonnet 5.5 rose to **47.5%**. |
| 03 | [Fuzzing a mainnet escrow that holds player funds](03-fuzzing-a-mainnet-escrow.md) | **~59.6M** stateful actions, **100%** source-line coverage, every money invariant held. A fuzzer and an AI vulnerability-hunting agent independently found the same fund-freeze bug class. |
| 04 | [Security lessons from operating with AI agents](04-agentic-ops-security-lessons.md) | A spoofable client IP that silently disabled every per-IP rate limit, an API key leaking in error bodies, a suspected key exposure through a third-party AI tool, and the agent rules we wrote afterwards. |

## How this work was done

I build HIM with AI coding agents: Claude Code, with Opus planning and reviewing, Sonnet building and Haiku doing sweeps. I chose the questions, designed or approved each experiment and its threat model, and own the conclusions. The agents wrote most of the harness code and ran the measurements. Every number in these notes comes from saved run logs.

This is deliberate. Part of what the notes test is whether a small team with agents can do honest red-teaming of its own product.

## Responsible disclosure

These notes come from a live system holding real funds. Infrastructure identifiers (account IDs, resource names, IPs, keys), detector thresholds and exploit steps for anything still open have been removed. Note 03 describes one issue only at class level until the on-chain fix is deployed.

## Code

[`code/motion-text/`](code/motion-text/) is the standalone prototype from note 02: server, browser client, the attacking decoder and the red-team runner. It does not touch HIM production and ships with its own sample questions, not HIM's question bank.

## License

Text: CC BY 4.0. Code: MIT.
