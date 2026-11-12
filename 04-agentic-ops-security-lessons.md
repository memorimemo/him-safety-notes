# 04 · Security lessons from operating with AI agents

*October 2026. Mehmet Tokgöz, Abrakadabra Games.*

HIM is built and operated by a very small team plus AI coding agents with real access: cloud credentials, deploy rights, and test wallets on devnet and mainnet. This note covers what nearly went wrong in one month, and the rules we adopted afterwards. Identifiers, IPs and thresholds have been removed.

## 1. A pre-launch audit found 8 high issues and 0 critical

Before real-money rooms went public, we audited the engine, front end and cloud setup. The money paths held up:

- deposit binding
- payout routing
- seed secrecy
- keeper-only actions

Eight issues were rated high. Two of them are good general lessons.

**A spoofable client IP silently disabled every per-IP limit.** Our load balancer *appends* the real peer address to `X-Forwarded-For`, but our code read the *first* entry, which the caller controls. Sending a random header with every request gave each request a fresh rate-limit bucket. Every limiter looked fine in tests and none of them worked against an attacker.
- Fix: trust only the entry N hops from the right, always parse it as an IP, and add a regression test that sends a spoofed first entry.

**A paid API key could leak in error bodies.** An upstream error message that contained the full request URL, query-string key included, was passed back to the caller.
- Fix: redact upstream errors at the boundary and never forward raw upstream text.

## 2. Log forensics: what a credential-hunting scanner looks like

When we turned on firewall logging, the per-IP rate rule (still in count-only mode) had fired on exactly one source in seven days. It was a hosting-provider IP sending **30,424 requests in about 6 minutes**, using an old spoofed user agent and our load balancer's raw IP as the Host header. It probed for:

- `.env`
- `phpinfo.php`
- `docker-compose`
- `aws_credentials.json`
- log backups

No real player came near the limit, so we could move the rule from *count* to *block* at a measured safe level instead of a guessed one. A near-identical scanner the same day was already blocked by a managed IP-reputation list.

## 3. A suspected key exposure through a third-party AI tool

A key that had been stored in a third-party AI coding-agent tool was suspected to be exposed. We revoked it, removed the tool and its local credential store, and watched spend afterwards. Some foreign-region usage we first took for an attacker turned out to be our own cross-region inference. That is a useful caution: **region-based signals are noisy when your own agents use global inference profiles.**

## 4. A secret printed once

An agent ran an admin script that prints a new API key exactly once. It then filtered the output with a regex that matched a *masked* id on an earlier line, so the real key went into the conversation transcript. We revoked it immediately and verified the revocation with a live request that came back unauthorized.

## The rules we adopted for agents

- **Secrets never reach chat, commits, PRs or logs.** Agents refer to keys by a short hash prefix, never by value.
- **Capture printed-once secrets by structure, not by guessing**, and redact output by default. If a value ever reaches output, rotate it at once and say so.
- **Least privilege and one credential owner.** Every unused user loses its credentials, and long-lived keys get replaced.
- **Explicit denies for capabilities you never use**, such as older model families or unused regions, as long as they don't cut off your own agents. Test that first.
- **Live real-user tests after every launch, not only mocked ones.** A mocked-wallet end-to-end test once hid a wallet flow that the content-security policy blocked in production. It stayed broken for two days.
- **Every money-path release gets an adversarial review**, and every security claim we publish needs a measurement behind it (see note 01).

## Open questions I want to work on

- How do credentials actually leak out of agentic workflows? Candidates: transcripts, tool output, error bodies, third-party agent tools, and prompt injection from fetched content into privileged tool calls.
- Which mitigations measurably help without making agents useless? Candidates: hash-referenced secrets, permission classifiers, scoped short-lived credentials.
- When agents hold wallet-signing ability, what is the right permission boundary, and how do you audit it?
