#!/usr/bin/env bash
# フォーク元 (upstream) の更新を現在のブランチにマージし、
# フォーク側の方針で答えが決まっている競合だけを自動で解消する。
#
#   - .github/workflows/**      : 常にフォーク側の内容を採用（フォーク元のワークフローは取り込まない）
#   - フォーク側で削除したファイル : 削除のまま（広告関連など）
#   - yarn.lock                  : フォーク元の内容を採用
#
# 使い方:
#   git fetch upstream master
#   bash .github/scripts/sync-upstream.sh
#
# 環境変数:
#   UPSTREAM_REF    マージするref（既定: upstream/master）
#   CONFLICT_FILE   手動解消が必要なファイル一覧の出力先（任意）
#   RESOLVED_FILE   自動解消したファイル一覧の出力先（任意）
#   KEEP_CONFLICTS  1 のとき、競合が残ってもマージを中断せずに終了する（手動解消用）
#
# 終了コード:
#   0  マージしてコミットした
#   10 取り込む更新がない
#   20 手動解消が必要な競合が残った
set -euo pipefail

UPSTREAM_REF="${UPSTREAM_REF:-upstream/master}"
CONFLICT_FILE="${CONFLICT_FILE:-/dev/null}"
RESOLVED_FILE="${RESOLVED_FILE:-/dev/null}"
KEEP_CONFLICTS="${KEEP_CONFLICTS:-0}"
WORKFLOWS_DIR=".github/workflows"

if git merge-base --is-ancestor "$UPSTREAM_REF" HEAD; then
  echo "取り込む更新はありません"
  exit 10
fi

upstream_sha=$(git rev-parse --short "$UPSTREAM_REF")
git merge --no-ff --no-commit "$UPSTREAM_REF" || true

: >"$RESOLVED_FILE"

# ワークフローはフォーク側の内容に戻す
changed_workflows=$(git diff --cached --name-only HEAD -- "$WORKFLOWS_DIR"; git diff --name-only --diff-filter=U -- "$WORKFLOWS_DIR")
if [ -n "$changed_workflows" ]; then
  git rm -r -q -f --ignore-unmatch -- "$WORKFLOWS_DIR"
  if git cat-file -e "HEAD:$WORKFLOWS_DIR" 2>/dev/null; then
    git checkout HEAD -- "$WORKFLOWS_DIR"
  fi
  echo "$changed_workflows" | sort -u | sed 's/$/ (フォーク側を採用)/' >>"$RESOLVED_FILE"
fi

# フォーク側で削除したファイルは削除のまま
git status --porcelain | awk '$1 == "DU" { print $2 }' | while read -r path; do
  git rm -q -- "$path"
  echo "$path (削除のまま)" >>"$RESOLVED_FILE"
done

# yarn.lock はフォーク元を採用
if git diff --name-only --diff-filter=U -- yarn.lock | grep -q .; then
  git checkout --theirs -- yarn.lock
  git add yarn.lock
  echo "yarn.lock (フォーク元を採用)" >>"$RESOLVED_FILE"
fi

remaining=$(git diff --name-only --diff-filter=U)
if [ -n "$remaining" ]; then
  echo "$remaining" >"$CONFLICT_FILE"
  echo "手動解消が必要な競合があります:"
  echo "$remaining" | sed 's/^/  /'
  if [ "$KEEP_CONFLICTS" != "1" ]; then
    git merge --abort
  fi
  exit 20
fi

git commit -q --no-edit -m "chore: フォーク元の更新を取り込み (upstream ${upstream_sha})"
echo "マージしました: $(git rev-parse --short HEAD)"
