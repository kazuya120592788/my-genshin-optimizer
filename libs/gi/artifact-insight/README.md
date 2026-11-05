# gi-artifact-insight

聖遺物の判定ロジック（画面を持たない）。

- `profiles`: キャラの型（有効サブステ・使えるメインステータス）と、装備からの型の推定
- `junkArtifacts`: 不要聖遺物の判定
- `upgradeChance`: +20 まで強化したときの Roll Value の分布
- `farming`: 秘境ごとの周回の期待値

`/junk-artifacts`・`/dashboard`・`/farming` のページから使う。

## Running unit tests

Run `nx test gi-artifact-insight` to execute the unit tests via [Vitest](https://vitest.dev).
