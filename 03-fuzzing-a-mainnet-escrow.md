# 03 · Fuzzing a mainnet escrow that holds player funds

*Campaign run 17 October 2026, local only (nothing sent to any chain). Mehmet Tokgöz, Abrakadabra Games.*

## The target

HIM's paid games settle through a small Anchor program on Solana mainnet.

- **Players:** stake SOL or a fan token into a per-game vault.
- **Game authority:** declares the winner.
- **Winner:** claims exactly 85% of the pool; the treasury gets 15%.
- **Cancellation:** cancelled games refund each depositor.
- **Candidate upgrade:** adds multi-place payouts from a payout table.

A bug here means real users lose real money, so the question was: **do the money invariants hold under adversarial sequences of actions, not just the happy paths in our tests?**

## Method

- **Tool:** Crucible (Asymmetric Research; LibAFL + LiteSVM), stateful mode.
- **Binaries:** the exact deployed program, the multi-winner upgrade candidate, a fix candidate, and a superseded older build used as a calibration target.
- **Harnesses:**
  - SOL path
  - SPL fan-token path, where the fuzzer chooses which token accounts are passed, including other players' accounts
  - 24-player wide harness covering larger payout tables
- **Spec model:** written from the Rust source's intent, not from the binaries. For every action it predicts must-succeed, must-fail or either, plus the exact lamport and token deltas.
- **Invariants checked after every action:**
  - lamport and token conservation
  - per-game solvency
  - on-chain state equals the model
  - only the authority can start, declare or cancel
  - no double join and no double claim
  - exact 85/15 split, and exact payout-table shares
  - a rejected transaction changes no balance
- **Arithmetic check:** separately, 4.8 million (players, pool) cases up to `u64::MAX` confirmed that shares always sum to the pool exactly.

## Scale

| | |
|---|---|
| Harness actions | **~59.6 million** |
| Worker-hours | ~20 |
| Source-line coverage, live program | **100%** (317/317) |
| Source-line coverage, multi-winner candidate | 95.8% (436/455; unhit lines are only the token branch of one instruction) |
| Critical / High findings | **0** |

**Invariants held:** no double claim or settle, no unauthorised declare, cancel or start, no SOL created or lost, and no payout different from 85/15 or the payout table.

## Calibration: would it have caught our real past bugs?

We pointed the token harness at the *superseded* build from September. That build had three defects we had already fixed on mainnet:

- a join without paying
- a redirectable refund
- a redirectable winner payout

Crucible found all three in under a minute. The same harness then ran ~4 million actions against the live build with zero violations. Calibration matters: a fuzzer that finds nothing is only evidence if you know it *can* find something.

## The one finding

The fuzzer rediscovered a **fund-freeze bug class** (Medium, Low with the mitigation already in production). It was first reported by an **AI vulnerability-hunting agent** we had run earlier.

- **Impact:** a griefer can make a rightful claim or refund fail until the vault is topped up. No funds can be stolen.
- **Mitigation:** our transaction builders already apply an off-chain mitigation, and with it on the fuzzer saw 0 violations across 4M+ actions.
- **On-chain fix:** a candidate showed 0 violations across ~11.5M actions. It also exposed that the planned multi-winner upgrade, *without* the fix, would add a third frozen path, so the upgrade we ship must be the fixed build.

Exact reproduction steps are withheld until the on-chain fix is deployed.

## What I took from it

- **Two independent methods converged:** an agent reading code, and a coverage-guided fuzzer with an exact oracle. When they agree, I trust the finding more. When only the agent reports something, the fuzzer is a cheap way to confirm it or kill it as a false positive.
- **Coverage tells you what was tested, not what is safe.** Line coverage of the source was the meaningful metric. Raw bytecode edge coverage plateaued at about 25–29%, because most of the ELF is framework, IDL and panic code.
- **The fuzzer cannot see trust problems.** Some risks are outside its reach: one authority key per game, permissionless look-alike games and caller-supplied treasuries. Those need client-side checks and key management, and we track them separately.

## Next

- Token path on multi-winner payouts.
- Upgrade compatibility over cloned live accounts.
- Transaction-level composition (several instructions in one transaction, CPI from an attacker program).
- A 5-minute fuzz job in CI on every program change.
