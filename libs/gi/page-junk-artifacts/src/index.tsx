import {
  useDataManagerEntries,
  useDataManagerValues,
} from '@genshin-optimizer/common/database-ui'
import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import type {
  ArtifactProfile,
  CharacterInsight,
  JunkConfig,
  JunkReason,
  JunkResult,
} from '@genshin-optimizer/gi/artifact-insight'
import {
  defaultJunkConfig,
  findJunkArtifacts,
  getUpgradeOutlook,
  getUsedSetKeys,
  junkConfigStorageKey,
  junkExcludedCharsStorageKey,
  junkProfiles,
  loadJunkConfig,
  loadJunkExcludedChars,
  resolveJunkProfiles,
  substatShortNames,
  useCharacterInsights,
} from '@genshin-optimizer/gi/artifact-insight'
import type { CharacterKey, SubstatKey } from '@genshin-optimizer/gi/consts'
import { allSubstatKeys } from '@genshin-optimizer/gi/consts'
import type { ICachedArtifact } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import {
  ArtifactCard,
  ArtifactEditor,
  CharacterName,
  CharIconSide,
  SubstatToggle,
} from '@genshin-optimizer/gi/ui'
import DeleteForeverIcon from '@mui/icons-material/DeleteForever'
import {
  Alert,
  Box,
  Button,
  CardContent,
  CardHeader,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  Grid,
  Slider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'

const PAGE_SIZE = 24

const reasonLabels: Record<JunkReason, string> = {
  badMainStat: 'メインが合わない',
  lowPotential: '伸びしろ不足',
  lowChance: '当たりにくい',
  dominated: '上位互換あり',
  unusedSet: '使わないセット',
  lowRarity: '星4以下',
}
const reasonColors: Record<
  JunkReason,
  'error' | 'warning' | 'info' | 'secondary' | 'primary' | 'success'
> = {
  badMainStat: 'secondary',
  lowPotential: 'error',
  lowChance: 'primary',
  dominated: 'warning',
  unusedSet: 'success',
  lowRarity: 'info',
}

const percent = (v: number) => `${Math.round(v * 100)}%`

type PageProfile = ArtifactProfile & {
  id: string
  label: ReactNode
  keys: SubstatKey[]
}

function useStored<T>(key: string, value: T) {
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // ストレージが使えない環境では保存しない
    }
  }, [key, value])
}

export default function PageJunkArtifacts() {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [config, setConfigState] = useState<JunkConfig>(loadJunkConfig)
  const setConfig = useCallback(
    (update: Partial<JunkConfig>) =>
      setConfigState((prev) => ({ ...prev, ...update })),
    []
  )
  useStored(junkConfigStorageKey, config)
  const [excludedChars, setExcludedChars] = useState<string[]>(
    loadJunkExcludedChars
  )
  useStored(junkExcludedCharsStorageKey, excludedChars)

  const arts = useDataManagerValues(database.arts)
  const buildEntries = useDataManagerEntries(database.builds)
  const usedInBuildIds = useMemo(() => {
    const ids = new Set<string>()
    for (const [, { artifactIds }] of buildEntries)
      for (const id of Object.values(artifactIds)) if (id) ids.add(id)
    return ids
  }, [buildEntries])

  const insights = useCharacterInsights()
  const usedSetKeys = useMemo(
    () =>
      getUsedSetKeys(
        insights,
        buildEntries.map(([, { artifactIds }]) =>
          Object.values(artifactIds)
            .map((id) => (id ? database.arts.get(id) : undefined))
            .filter((a): a is ICachedArtifact => !!a)
        )
      ),
    [insights, buildEntries, database]
  )

  // 判定に使う型
  const profiles = useMemo<PageProfile[]>(
    () =>
      resolveJunkProfiles(config, insights, excludedChars).map((p) => ({
        ...p,
        keys: [...p.keys],
        label:
          config.mode === 'characters' ? (
            <CharacterName
              characterKey={p.id as CharacterKey}
              gender={gender}
            />
          ) : config.mode === 'single' ? (
            '指定'
          ) : (
            junkProfiles.find(({ id }) => id === p.id)?.label
          ),
      })),
    [config, insights, excludedChars, gender]
  )
  const results = useMemo(
    () =>
      !profiles.length
        ? []
        : findJunkArtifacts(arts, usedInBuildIds, config, {
            profiles,
            usedSetKeys,
          }),
    [arts, usedInBuildIds, config, profiles, usedSetKeys]
  )

  const [reasonFilter, setReasonFilter] = useState<JunkReason[]>([])
  const shownResults = useMemo(
    () =>
      reasonFilter.length
        ? results.filter((r) =>
            reasonFilter.every((f) => r.reasons.includes(f))
          )
        : results,
    [results, reasonFilter]
  )
  const [limit, setLimit] = useState(PAGE_SIZE)
  useEffect(() => setLimit(PAGE_SIZE), [config, reasonFilter])

  const reasonCounts = useMemo(() => {
    const counts = Object.fromEntries(
      Object.keys(reasonLabels).map((r) => [r, 0])
    ) as Record<JunkReason, number>
    for (const r of results) for (const reason of r.reasons) counts[reason]++
    return counts
  }, [results])

  const [artifactIdToEdit, setArtifactIdToEdit] = useState<string>()
  const [compareResult, setCompareResult] = useState<JunkResult>()

  const deleteAllShown = () => {
    if (!shownResults.length) return
    if (
      !window.confirm(
        `表示中の不要候補 ${shownResults.length} 個をすべて削除します。よろしいですか？\n（ゲーム内の聖遺物は削除されません）`
      )
    )
      return
    shownResults.forEach(({ id }) => database.arts.remove(id))
  }

  return (
    <Stack spacing={1} sx={{ my: 1 }}>
      <Suspense fallback={false}>
        <ArtifactEditor
          artifactIdToEdit={artifactIdToEdit}
          cancelEdit={() => setArtifactIdToEdit(undefined)}
        />
      </Suspense>
      <DominatedModal
        result={compareResult}
        keys={
          compareResult
            ? (profiles[compareResult.bestProfileIndex]?.keys ?? [])
            : []
        }
        onClose={() => setCompareResult(undefined)}
      />
      <CardThemed>
        <CardHeader
          title="不要聖遺物チェッカー"
          subheader="条件に当てはまる聖遺物を「不要候補」として一覧表示します。素材にする聖遺物を探すときに使ってください。"
        />
        <Divider />
        <CardContent>
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                判定のしかた
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                color="primary"
                value={config.mode}
                onChange={(_, mode) => mode && setConfig({ mode })}
              >
                <ToggleButton value="characters">所持キャラの型</ToggleButton>
                <ToggleButton value="allProfiles">
                  どのキャラでも不要
                </ToggleButton>
                <ToggleButton value="single">型を指定して判定</ToggleButton>
              </ToggleButtonGroup>
            </Box>

            {config.mode === 'characters' && (
              <CharacterProfiles
                insights={insights}
                excluded={excludedChars}
                setExcluded={setExcludedChars}
              />
            )}
            {config.mode === 'allProfiles' && (
              <Box>
                <Typography variant="subtitle1" gutterBottom>
                  考慮するキャラの型
                </Typography>
                <Box display="flex" gap={1} flexWrap="wrap">
                  {junkProfiles.map(({ id, label, keys }) => {
                    const selected = config.profileIds.includes(id)
                    return (
                      <Chip
                        key={id}
                        label={`${label}（${keys.map((k) => substatShortNames[k]).join('・')}）`}
                        color={selected ? 'primary' : 'default'}
                        variant={selected ? 'filled' : 'outlined'}
                        onClick={() =>
                          setConfig({
                            profileIds: selected
                              ? config.profileIds.filter((p) => p !== id)
                              : [...config.profileIds, id],
                          })
                        }
                      />
                    )
                  })}
                </Box>
                <Typography variant="caption" color="text.secondary">
                  各カードの Roll Value
                  は、その聖遺物が一番向いている型で表示します。選んだ型のすべてで不要と判定された聖遺物だけを候補にします。どれか1つの型で使い道があれば候補に入りません。
                </Typography>
              </Box>
            )}
            {config.mode === 'single' && (
              <Box>
                <Typography variant="subtitle1" gutterBottom>
                  有効サブステータス
                </Typography>
                <Box display="flex" gap={1} flexWrap="wrap" mb={1}>
                  {junkProfiles.map(({ id, label, keys }) => (
                    <Chip
                      key={id}
                      label={label}
                      size="small"
                      onClick={() => setConfig({ usefulSubstats: keys })}
                      color={
                        keys.length === config.usefulSubstats.length &&
                        keys.every((k) => config.usefulSubstats.includes(k))
                          ? 'primary'
                          : 'default'
                      }
                    />
                  ))}
                </Box>
                <SubstatToggle
                  selectedKeys={config.usefulSubstats}
                  onChange={(usefulSubstats) => setConfig({ usefulSubstats })}
                />
                {!config.usefulSubstats.length && (
                  <Typography variant="caption" color="text.secondary">
                    未選択のときはすべてのサブステータスを有効とみなします。
                  </Typography>
                )}
              </Box>
            )}
            {!profiles.length && (
              <Alert severity="warning">
                {config.mode === 'characters'
                  ? '型を推定できるキャラがいません。キャラに聖遺物を装備させるか、ほかの判定のしかたを選んでください。'
                  : '型を1つ以上選んでください。'}
              </Alert>
            )}

            <Box>
              <Typography variant="subtitle1">判定条件</Typography>
              <Stack spacing={1}>
                <Box>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={config.checkBadMainStat}
                        onChange={(_, checkBadMainStat) =>
                          setConfig({ checkBadMainStat })
                        }
                      />
                    }
                    label="メインが合わない: 時計・杯・冠のメインステータスが型に合わない"
                  />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    component="div"
                  >
                    例: 攻撃会心型の防御%
                    時計。時計は伸ばすステータスかチャージ、杯は伸ばすステータス（会心型なら元素・物理ダメージも）、冠は伸ばすステータスと会心（サポート型なら治療効果も）を合うものとします。
                  </Typography>
                </Box>
                <Box>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={config.checkLowPotential}
                        onChange={(_, checkLowPotential) =>
                          setConfig({ checkLowPotential })
                        }
                      />
                    }
                    label={`伸びしろ不足: +20 まで強化しても Max. Roll Value が ${percent(config.minMaxEfficiency)} 未満`}
                  />
                  <Box px={2} maxWidth={480}>
                    <Slider
                      size="small"
                      disabled={!config.checkLowPotential}
                      value={config.minMaxEfficiency}
                      min={1}
                      max={8}
                      step={0.5}
                      marks
                      valueLabelDisplay="auto"
                      valueLabelFormat={percent}
                      onChange={(_, v) =>
                        setConfig({ minMaxEfficiency: v as number })
                      }
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    聖遺物カードの「Max. Roll
                    Value」と同じ値で、有効サブステだけを数えます（星5の最大値1回分
                    =
                    100%）。未強化の聖遺物は、残りの強化がすべて有効サブステに最大値で伸びた場合の値です。
                  </Typography>
                </Box>
                <Box>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={config.checkLowChance}
                        onChange={(_, checkLowChance) =>
                          setConfig({ checkLowChance })
                        }
                      />
                    }
                    label={`当たりにくい: 強化途中の星5で、+20 にしても Roll Value が ${percent(config.goodEfficiency)} 以上になる確率が ${percent(config.minGoodChance)} 未満`}
                  />
                  <Box px={2} maxWidth={480}>
                    <Slider
                      size="small"
                      disabled={!config.checkLowChance}
                      value={config.minGoodChance}
                      min={0.05}
                      max={0.5}
                      step={0.05}
                      marks
                      valueLabelDisplay="auto"
                      valueLabelFormat={percent}
                      onChange={(_, v) =>
                        setConfig({ minGoodChance: v as number })
                      }
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    ゲームと同じ確率（強化のたびに4つのサブステから1つが伸びる・4段階の伸び幅が等確率）で計算します。強化に素材を使う前のふるい分けに使えます。
                  </Typography>
                </Box>
                <Box>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={config.checkDominated}
                        onChange={(_, checkDominated) =>
                          setConfig({ checkDominated })
                        }
                      />
                    }
                    label={`上位互換あり: 同じセット・部位・メインの上位互換が ${config.dominatedCount} 個以上ある`}
                  />
                  <Box px={2} maxWidth={480}>
                    <Slider
                      size="small"
                      disabled={!config.checkDominated}
                      value={config.dominatedCount}
                      min={1}
                      max={5}
                      step={1}
                      marks
                      valueLabelDisplay="auto"
                      onChange={(_, v) =>
                        setConfig({ dominatedCount: v as number })
                      }
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    レア度・レベルが同じか上で、有効サブステの値がすべて同じか上回っている聖遺物を上位互換とみなします。カードの「上位互換あり」を押すと見比べられます。
                  </Typography>
                </Box>
                <Box>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={config.checkUnusedSet}
                        onChange={(_, checkUnusedSet) =>
                          setConfig({ checkUnusedSet })
                        }
                      />
                    }
                    label="使わないセット: どのキャラも2つ以上装備しておらず、保存済みビルドでも使っていないセット"
                  />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    component="div"
                  >
                    ただし、メインが合っていて Max. Roll Value が当たりの目安（
                    {percent(config.goodEfficiency)}
                    ）以上のものは、オフピースに使えるので残します。型の判定とは関係なく候補にします。
                  </Typography>
                </Box>
                <Box>
                  <Typography>
                    当たりの目安: Roll Value {percent(config.goodEfficiency)}
                  </Typography>
                  <Box px={2} maxWidth={480}>
                    <Slider
                      size="small"
                      value={config.goodEfficiency}
                      min={3}
                      max={8}
                      step={0.5}
                      marks
                      valueLabelDisplay="auto"
                      valueLabelFormat={percent}
                      onChange={(_, v) =>
                        setConfig({ goodEfficiency: v as number })
                      }
                    />
                  </Box>
                </Box>
                <FormControlLabel
                  disabled={config.excludeLowRarity}
                  control={
                    <Checkbox
                      checked={
                        config.checkLowRarity && !config.excludeLowRarity
                      }
                      onChange={(_, checkLowRarity) =>
                        setConfig({ checkLowRarity })
                      }
                    />
                  }
                  label={
                    config.excludeLowRarity
                      ? '星4以下（「対象外にする聖遺物」で星4以下を除外中）'
                      : '星4以下'
                  }
                />
              </Stack>
            </Box>

            <Box>
              <Typography variant="subtitle1">対象外にする聖遺物</Typography>
              <Box display="flex" flexWrap="wrap">
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={config.excludeLowRarity}
                      onChange={(_, excludeLowRarity) =>
                        setConfig({ excludeLowRarity })
                      }
                    />
                  }
                  label="星4以下"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={config.excludeLocked}
                      onChange={(_, excludeLocked) =>
                        setConfig({ excludeLocked })
                      }
                    />
                  }
                  label="ロック中"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={config.excludeEquipped}
                      onChange={(_, excludeEquipped) =>
                        setConfig({ excludeEquipped })
                      }
                    />
                  }
                  label="装備中"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={config.excludeInBuilds}
                      onChange={(_, excludeInBuilds) =>
                        setConfig({ excludeInBuilds })
                      }
                    />
                  }
                  label="保存済みビルドで使用中"
                />
              </Box>
            </Box>
            <Box>
              <Button
                size="small"
                color="secondary"
                onClick={() => setConfigState(defaultJunkConfig)}
              >
                設定を初期値に戻す
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </CardThemed>

      <CardThemed>
        <CardContent>
          <Box
            display="flex"
            gap={1}
            flexWrap="wrap"
            alignItems="center"
            justifyContent="space-between"
          >
            <Box display="flex" gap={1} flexWrap="wrap" alignItems="center">
              <Typography>
                不要候補 <strong>{shownResults.length}</strong> 個
                {shownResults.length !== results.length &&
                  ` / ${results.length} 個`}
                （全 {arts.length} 個中）
              </Typography>
              {(Object.keys(reasonLabels) as JunkReason[])
                .filter(
                  (reason) =>
                    (reason !== 'lowRarity' || !config.excludeLowRarity) &&
                    (reasonCounts[reason] || reasonFilter.includes(reason))
                )
                .map((reason) => (
                  <Chip
                    key={reason}
                    size="small"
                    label={`${reasonLabels[reason]} ${reasonCounts[reason]}`}
                    color={
                      reasonFilter.includes(reason)
                        ? reasonColors[reason]
                        : 'default'
                    }
                    onClick={() =>
                      setReasonFilter((prev) =>
                        prev.includes(reason)
                          ? prev.filter((r) => r !== reason)
                          : [...prev, reason]
                      )
                    }
                  />
                ))}
            </Box>
            <Button
              color="error"
              variant="outlined"
              size="small"
              startIcon={<DeleteForeverIcon />}
              disabled={!shownResults.length}
              onClick={deleteAllShown}
            >
              表示中をすべて削除
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary">
            理由のチップを押すと、その理由に当てはまるものだけに絞り込めます。伸びしろが小さい順に並んでいます。
          </Typography>
        </CardContent>
      </CardThemed>

      {!results.length && !!profiles.length && (
        <Alert variant="filled" severity="success">
          条件に当てはまる不要候補はありません。
        </Alert>
      )}

      <Grid container spacing={1} columns={{ xs: 1, sm: 2, md: 3, lg: 4 }}>
        {shownResults.slice(0, limit).map((result) => (
          <Grid item xs={1} key={result.id}>
            <JunkItem
              result={result}
              keys={profiles[result.bestProfileIndex]?.keys ?? []}
              bestProfileLabel={
                config.mode !== 'single'
                  ? profiles[result.bestProfileIndex]?.label
                  : undefined
              }
              goodEfficiency={config.goodEfficiency}
              onEdit={() => setArtifactIdToEdit(result.id)}
              onCompare={() => setCompareResult(result)}
            />
          </Grid>
        ))}
      </Grid>
      {shownResults.length > limit && (
        <Button onClick={() => setLimit((l) => l + PAGE_SIZE)}>
          さらに表示（残り {shownResults.length - limit} 個）
        </Button>
      )}
    </Stack>
  )
}

function CharacterProfiles({
  insights,
  excluded,
  setExcluded,
}: {
  insights: CharacterInsight[]
  excluded: string[]
  setExcluded: (keys: string[]) => void
}) {
  const { gender } = useDBMeta()
  return (
    <Box>
      <Typography variant="subtitle1" gutterBottom>
        キャラごとに推定した型（
        {insights.length -
          excluded.filter((k) => insights.some((i) => i.key === k)).length}{' '}
        人）
      </Typography>
      <Box display="flex" gap={1} flexWrap="wrap">
        {insights.map(({ key, profile, fromOptConfig }) => {
          const selected = !excluded.includes(key)
          return (
            <Chip
              key={key}
              icon={<CharIconSide characterKey={key} />}
              label={
                <span>
                  <CharacterName characterKey={key} gender={gender} />（
                  {profile.keys.map((k) => substatShortNames[k]).join('・')}
                  {fromOptConfig && '・最適化設定'}）
                </span>
              }
              color={selected ? 'primary' : 'default'}
              variant={selected ? 'filled' : 'outlined'}
              onClick={() =>
                setExcluded(
                  selected
                    ? [...excluded, key]
                    : excluded.filter((k) => k !== key)
                )
              }
            />
          )
        })}
      </Box>
      <Typography variant="caption" color="text.secondary">
        装備中の時計・杯・冠のメインステータス（最適化画面でメインステータスを絞り込んでいればその設定）から、キャラごとに有効サブステと使えるメインステータスを推定します。どのキャラにも使い道がない聖遺物だけを候補にします。チップを押すと、そのキャラを判定から外せます。
      </Typography>
    </Box>
  )
}

function JunkItem({
  result,
  keys,
  bestProfileLabel,
  goodEfficiency,
  onEdit,
  onCompare,
}: {
  result: JunkResult
  keys: SubstatKey[]
  bestProfileLabel?: ReactNode
  goodEfficiency: number
  onEdit: () => void
  onCompare: () => void
}) {
  const database = useDatabase()
  const effFilter = useMemo(
    () => new Set<SubstatKey>(keys.length ? keys : allSubstatKeys),
    [keys]
  )
  const { id, reasons, maxEfficiency, dominatedBy } = result
  // 理由の表示がどのカードのものか分かるよう、カードと一緒に枠で囲む
  const art = database.arts.get(id)
  const outlook = useMemo(
    () => (art && art.level < 20 ? getUpgradeOutlook(art, keys) : undefined),
    [art, keys]
  )
  return (
    <CardThemed
      bgt="light"
      variant="outlined"
      sx={{
        height: '100%',
        p: 0.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        borderColor: 'divider',
        borderWidth: 2,
      }}
    >
      <Box
        display="flex"
        gap={0.5}
        flexWrap="wrap"
        alignItems="center"
        px={0.5}
        pt={0.5}
      >
        {reasons.map((reason) => (
          <Chip
            key={reason}
            size="small"
            color={reasonColors[reason]}
            onClick={reason === 'dominated' ? onCompare : undefined}
            label={
              reason === 'dominated'
                ? `${reasonLabels[reason]} (${dominatedBy.length}) ▸ 比べる`
                : reason === 'lowPotential' && !bestProfileLabel
                  ? `${reasonLabels[reason]} (最大 ${percent(maxEfficiency)})`
                  : reasonLabels[reason]
            }
          />
        ))}
      </Box>
      {bestProfileLabel && maxEfficiency > 0 && (
        <Typography variant="caption" color="text.secondary" px={0.5}>
          向いている型: {bestProfileLabel}（Max. Roll Value{' '}
          {percent(maxEfficiency)}）
        </Typography>
      )}
      {outlook && (
        <Typography variant="caption" color="text.secondary" px={0.5}>
          +20 にしたとき: Roll Value 期待値 {percent(outlook.expected)}・
          {percent(goodEfficiency)} 以上になる確率{' '}
          {percent(outlook.chanceAtLeast(goodEfficiency))}
        </Typography>
      )}
      <Box flexGrow={1}>
        <ArtifactCard
          artifactId={id}
          effFilter={effFilter}
          setLocation={(location) => database.arts.set(id, { location })}
          onLockToggle={() =>
            database.arts.set(id, ({ lock }) => ({ lock: !lock }))
          }
          onDelete={() => database.arts.remove(id)}
          onEdit={onEdit}
        />
      </Box>
    </CardThemed>
  )
}

/** 不要候補と、その上位互換を並べて見比べる */
function DominatedModal({
  result,
  keys,
  onClose,
}: {
  result?: JunkResult
  keys: SubstatKey[]
  onClose: () => void
}) {
  const effFilter = useMemo(
    () => new Set<SubstatKey>(keys.length ? keys : allSubstatKeys),
    [keys]
  )
  return (
    <ModalWrapper open={!!result} onClose={onClose}>
      <CardThemed>
        <CardHeader
          title="上位互換との比較"
          subheader={`有効サブステ: ${(keys.length ? keys : allSubstatKeys).map((k) => substatShortNames[k]).join('・')}`}
          action={<Button onClick={onClose}>閉じる</Button>}
        />
        <Divider />
        {result && (
          <CardContent>
            <Grid container spacing={1} columns={{ xs: 1, sm: 2, md: 3 }}>
              <Grid item xs={1}>
                <Typography gutterBottom>不要候補</Typography>
                <ArtifactCard artifactId={result.id} effFilter={effFilter} />
              </Grid>
              {result.dominatedBy.map((otherId, i) => (
                <Grid item xs={1} key={otherId}>
                  <Typography gutterBottom>上位互換 {i + 1}</Typography>
                  <ArtifactCard artifactId={otherId} effFilter={effFilter} />
                </Grid>
              ))}
            </Grid>
          </CardContent>
        )}
      </CardThemed>
    </ModalWrapper>
  )
}
