# stuck

Find bridge withdrawals that were never claimed. Many bridges need one last step on the destination chain (prove, finalize, claim, redeem). If nobody does it, the funds just sit there.

`stuck` checks a wallet across 23 bridges and tells you what is still waiting, how much it is worth, and how to claim it. It is read-only: no wallet connection, no signing, no transactions. Where possible the claim itself is simulated with `eth_call`, so "claimable" means the claim would actually go through right now.

## Setup

Needs Node 20+ and an [Alchemy](https://www.alchemy.com) key with the chains below enabled.

```sh
npm install
echo "ALCHEMY_KEY=..." > .env     # or ALCHEMY_PASS_ENTRY=<entry> to read it from pass; .env is gitignored
```

## Usage

Check one or more wallets on every bridge (a few seconds per wallet):

```sh
./stuck check 0xWALLET
./stuck check 0xWALLET1 0xWALLET2 --file wallets.txt
./stuck check 0xWALLET --bridges base,cctp,wormhole   # only some bridges
./stuck check 0xWALLET --min-usd 5                    # hide priced dust
./stuck check 0xWALLET --all                          # also show claimed and still-waiting items
./stuck check 0xWALLET --json                         # machine output (includes claim data where available)
```

Scan a whole bridge for anyone's stuck withdrawals in a block window:

```sh
./stuck scan base --days 30
./stuck scan zksync --from 72000000 --to 72300000
./stuck scan ronin --days 365 --min-usd 100 --min-age 7
```

`scan` works on the OP Stack chains, Arbitrum, Linea, zkSync, Gnosis, Ronin and Starknet.

## Statuses

| Status | Meaning |
|---|---|
| `claimable`, `ready-to-prove`, `ready-to-finalize` | The owner can claim it now. The output says where and how. |
| `blocked` | Stuck until the bridge team acts (expired signatures, disabled exits, old validator set). |
| `waiting` | Still inside the normal bridge delay. |
| `claimed` | Done. Shown with `--all`. |
| `unknown` | Could not be verified on-chain; the detail line says why. |

USD values are estimates from Alchemy Prices. Tokens without a price show as `$?` and count as $0 in totals.

## Bridges

| Key | Bridge | How it checks |
|---|---|---|
| `base` `optimism` `zora` `ink` `unichain` `soneium` `worldchain` `shape` `blast` (`mode` scan only) | OP Stack | Withdrawal status via the OptimismPortal (viem op-stack). OP Mainnet includes pre-Bedrock withdrawals that bridge apps no longer show. |
| `arbitrum` | Arbitrum One (Nitro) | `Outbox.isSpent`; ready once past the challenge window. |
| `polygon` | Polygon PoS | Exit payload from Polygon's proof API, then `RootChainManager.exit` simulated. |
| `linea` | Linea | Message status on LineaRollup (legacy and merkle-proof messages). |
| `zksync` | ZKsync Era | L2 to L1 log proof, then `isWithdrawalFinalized` on L1. |
| `scroll` | Scroll | Scroll bridge API (unclaimed withdrawals). |
| `cctp` | Circle CCTP v1 and v2 | Iris attestation, destination used nonces, `receiveMessage` simulated (EVM and Solana). |
| `wormhole` `wormhole-ntt` | Wormhole Token Bridge and NTT | Wormholescan operations, redeem simulated on EVM, claim accounts read on Solana. |
| `debridge` | deBridge DLN | Unfilled or cancelled-but-unrefunded orders, confirmed on DlnSource / DlnDestination. |
| `gnosis` | Gnosis OmniBridge and xDai bridge | Validator signatures from Gnosis, `executeSignatures` simulated on Ethereum. |
| `starknet` | StarkGate (35 L1 bridges) | Unconsumed L2 to L1 messages, `withdraw` simulated on Ethereum. |
| `starkex` | StarkEx apps (dYdX v3, Immutable X, Sorare, rhino.fi, edgeX, ApeX, Myria, tanX, Reddio and more) | Pending withdrawal balances per Stark key, `withdraw` simulated. |
| `ronin` | Ronin Bridge | Operator signatures from Ronin, `submitWithdrawal` simulated on Ethereum. Includes pre-2022 withdrawals migrated to the new gateway. |
| `sui` | Sui Bridge | Committee approval from the Sui bridge record, claim simulated on Ethereum. |

Built-in bridges live in `stuck.mjs`. The others are modules in `bridges/`: each default-exports one bridge object (or an array) with `key`, `name`, `find(user, range)` and `status(item)`. Shared helpers are in `lib.mjs`. Drop a new file in `bridges/` and it is picked up automatically.

## Cache

`starknet`, `ronin` and `sui` keep an index under `.cache/` because their recipients are not searchable on-chain. The first run builds it (15 seconds to about 2.5 minutes, with progress on stderr); later runs only fetch new blocks and take about a second. Delete `.cache/` to rebuild from scratch.

## Known gaps

- Only EVM (`0x`) wallets can be searched. Transfers from those wallets to Solana and other chains are still found.
- CCTP: burns that start on Sonic, Plasma, Cronos or X Layer are not found; mints on Noble, Sui and Aptos show `unknown`.
- deBridge: orders created from Solana or Tron are not found.
- Wormhole: Sui, Aptos and NEAR destinations fall back to Wormholescan's status (`unknown`).
- Arbitrum: readiness uses the challenge window age, and pre-Nitro (classic) withdrawals are not covered. Polygon: Plasma (POL/MATIC) exits are not covered.

## Claiming safely

Always claim with your own wallet through the bridge's official app or contract, and check contract addresses against the bridge's docs or L2BEAT. Never share a seed phrase or private key, and never sign a token approval to "unlock" funds.

## License

MIT, Aaron Elijah Mars
