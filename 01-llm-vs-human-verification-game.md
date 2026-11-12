# 01 · Can a cheap LLM play a human-verification game?

*Measured 9 October 2026 on the HIM production question pools. Mehmet Tokgöz, Abrakadabra Games.*

## The question

HIM sells a simple idea: people compete on knowledge, under time pressure, sometimes for real stakes. Over a month we had layered many "anti-bot" mechanics on top of that idea:

- questions drawn on a canvas instead of DOM text
- answers you catch as moving gems
- per-player option shuffles
- server-side answer keys
- points that "melt" the longer you take
- a timing-based human score
- review holds on suspicious wallets

The founder's question was blunt: **how much do these mechanics actually lower the rate at which a bot answers correctly?**

## Method

- **Bot:** Claude Haiku 5.5 (the cheapest tier) on Amazon Bedrock, text only, thinking disabled, one letter requested, options shuffled per question exactly as the live engine does, one retry on an unparseable reply.
- **Questions:** 260 classic questions, all exactly as served to players.
  - 200 sampled from the public free pools (8 topics, stratified).
  - 60 from the engine's own question bank.
  - Separately, the 5 "fresh-event" questions published at run time.
- **What we did not touch:** no live league, prize duel or paid room. We only measured how well a model can *read and answer*.

## Result

| Set | n | Correct | Accuracy | Model latency (median / p90) |
|---|---|---|---|---|
| Free pools | 200 | 197 | 98.5% | 650 / 846 ms |
| Engine bank | 60 | 58 | 96.7% | 656 / 861 ms |
| **Combined** | **260** | **255** | **98.1%** | **652 / 846 ms** |
| Fresh-event only | 5 | 1 | (n too small) | 695 ms |

- **Repeatability:** a run two weeks earlier gave 97.5%. The standard error at n = 260 is about 0.8 points.
- **Cost:** all 260 answers cost **$0.0033** in total, about $0.0001 per 8-question round. Compute is not a deterrent.

## What each mechanic actually did

We sorted every live layer into four types: *prevents answering*, *slows*, *detects after the fact*, or *imposes an economic or identity cost*. **The "prevents answering" column was empty.** Some layers do stop specific shortcuts:

- server-held answer keys stop key lookup
- per-player shuffles stop letter-sharing between colluding wallets
- server replay stops forged move logs

None of them stops a model from reading a question and picking the answer.

- **Canvas text:** the question text still arrives in the API response, and a screenshot works anyway. In an earlier test a vision model read a rendered card 92.5–100% of the time.
- **Moving gems:** the catch is a UI effect. Score and pick are just an index, and a keyboard shortcut (an accessibility feature we keep) picks any launched gem.
- **Melting points:** the clock starts after a free reading window (median 3.2 s), and a 0.9 s bot sits inside it. This mechanic does hurt one attacker: **a human relaying questions to an LLM on a second device** loses 45–80% of their points.

## A bot that hides

Fast or perfect play is easy to flag. So we modelled a bot that adds 3–6 s of random delay and misses 5% on purpose. With the real scoring function and the real word counts, it slips past every live detector and still scores about **681 points per round, against roughly 300 for a typical human**, about 2.3×. The human timing and accuracy figures here are assumptions, because we had no real-player baseline yet. That missing baseline turned out to be the single most important finding.

## What changed

1. **The public claim.** We had been close to saying "bot-proof". The brand rules now allow only "we measure bots and watch for them". Banned phrases include "bot-proof", "AI-proof" and "only humans can win", plus any bots-blocked figure we have not measured.
2. **The roadmap.** First, collect a real-player baseline and require a human-looking play history before staking. Then turn the gem catch into server-verifiable evidence (seeded trajectories and replay), so detectors can re-score old rounds as they improve.
3. **Our view of the problem.** For knowledge questions, *preventing* a frontier model from answering is not a realistic goal. Raising its cost, detecting it and attaching identity cost to the prize stages are.

## Why this matters beyond one product

Proof-of-personhood and CAPTCHA-style gates are becoming safety infrastructure. This is a small, real data point on how quickly a cheap model saturates a defense that *looks* strong. It also shows how easily a product team can overclaim without a measurement.

## Limits

- Text only, no search tool. A browsing bot would do better on fresh-event questions.
- Haiku is the weakest tier. Stronger models would not do worse.
- Human figures in the bot-that-hides model are assumptions, not field data.
