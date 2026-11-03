import {
  useDataManagerEntries,
  useDataManagerValues,
} from '@genshin-optimizer/common/database-ui'
import { CardThemed } from '@genshin-optimizer/common/ui'
import type { SubstatKey } from '@genshin-optimizer/gi/consts'
import { allSubstatKeys } from '@genshin-optimizer/gi/consts'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import {
  ArtifactCard,
  ArtifactEditor,
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
  Typography,
} from '@mui/material'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import type { JunkConfig, JunkReason, JunkResult } from './junkArtifacts'
import { defaultJunkConfig, findJunkArtifacts } from './junkArtifacts'

const STORAGE_KEY = 'gi_page_my_junk_config'
const PAGE_SIZE = 24

const reasonLabels: Record<JunkReason, string> = {
  lowPotential: '伸びしろ不足',
  dominated: '上位互換あり',
  lowRarity: '星4以下',
}
const reasonColors: Record<JunkReason, 'error' | 'warning' | 'info'> = {
  lowPotential: 'error',
  dominated: 'warning',
  lowRarity: 'info',
}

const presets: Array<{ label: string; keys: SubstatKey[] }> = [
  { label: '攻撃会心', keys: ['atk_', 'critRate_', 'critDMG_'] },
  { label: 'HP会心', keys: ['hp_', 'critRate_', 'critDMG_'] },
  { label: '防御会心', keys: ['def_', 'critRate_', 'critDMG_'] },
  { label: '熟知会心', keys: ['eleMas', 'critRate_', 'critDMG_'] },
  { label: '熟知', keys: ['eleMas', 'enerRech_'] },
  { label: '会心のみ', keys: ['critRate_', 'critDMG_'] },
]

function loadConfig(): JunkConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultJunkConfig
    const parsed = JSON.parse(raw) as Partial<JunkConfig>
    return {
      ...defaultJunkConfig,
      ...parsed,
      usefulSubstats: (parsed.usefulSubstats ?? []).filter((k) =>
        allSubstatKeys.includes(k)
      ),
    }
  } catch {
    return defaultJunkConfig
  }
}

export default function PageMy() {
  const database = useDatabase()
  const [config, setConfigState] = useState<JunkConfig>(loadConfig)
  const setConfig = useCallback(
    (update: Partial<JunkConfig>) =>
      setConfigState((prev) => ({ ...prev, ...update })),
    []
  )
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    } catch {
      // ストレージが使えない環境では保存しない
    }
  }, [config])

  const arts = useDataManagerValues(database.arts)
  const buildEntries = useDataManagerEntries(database.builds)
  const usedInBuildIds = useMemo(() => {
    const ids = new Set<string>()
    for (const [, { artifactIds }] of buildEntries)
      for (const id of Object.values(artifactIds)) if (id) ids.add(id)
    return ids
  }, [buildEntries])

  const results = useMemo(
    () => findJunkArtifacts(arts, usedInBuildIds, config),
    [arts, usedInBuildIds, config]
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
    const counts: Record<JunkReason, number> = {
      lowPotential: 0,
      dominated: 0,
      lowRarity: 0,
    }
    for (const r of results) for (const reason of r.reasons) counts[reason]++
    return counts
  }, [results])

  const effFilter = useMemo(
    () =>
      new Set<SubstatKey>(
        config.usefulSubstats.length ? config.usefulSubstats : allSubstatKeys
      ),
    [config.usefulSubstats]
  )

  const [artifactIdToEdit, setArtifactIdToEdit] = useState<string>()

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
                有効サブステータス
              </Typography>
              <Box display="flex" gap={1} flexWrap="wrap" mb={1}>
                {presets.map(({ label, keys }) => (
                  <Chip
                    key={label}
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

            <Box>
              <Typography variant="subtitle1">判定条件</Typography>
              <Stack spacing={1}>
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
                    label={`伸びしろ不足: +20 まで強化しても Max. Roll Value が ${Math.round(config.minMaxEfficiency * 100)}% 未満`}
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
                      valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
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
                    レア度・レベルが同じか上で、有効サブステの値がすべて同じか上回っている聖遺物を上位互換とみなします。
                  </Typography>
                </Box>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={config.checkLowRarity}
                      onChange={(_, checkLowRarity) =>
                        setConfig({ checkLowRarity })
                      }
                    />
                  }
                  label="星4以下"
                />
              </Stack>
            </Box>

            <Box>
              <Typography variant="subtitle1">対象外にする聖遺物</Typography>
              <Box display="flex" flexWrap="wrap">
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
              {(Object.keys(reasonLabels) as JunkReason[]).map((reason) => (
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

      {!results.length && (
        <Alert variant="filled" severity="success">
          条件に当てはまる不要候補はありません。
        </Alert>
      )}

      <Grid container spacing={1} columns={{ xs: 1, sm: 2, md: 3, lg: 4 }}>
        {shownResults.slice(0, limit).map((result) => (
          <Grid item xs={1} key={result.id}>
            <JunkItem
              result={result}
              effFilter={effFilter}
              onEdit={() => setArtifactIdToEdit(result.id)}
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

function JunkItem({
  result,
  effFilter,
  onEdit,
}: {
  result: JunkResult
  effFilter: Set<SubstatKey>
  onEdit: () => void
}) {
  const database = useDatabase()
  const { id, reasons, maxEfficiency, dominatedBy } = result
  return (
    <Stack spacing={0.5} sx={{ height: '100%' }}>
      <Box display="flex" gap={0.5} flexWrap="wrap" alignItems="center">
        {reasons.map((reason) => (
          <Chip
            key={reason}
            size="small"
            color={reasonColors[reason]}
            label={
              reason === 'dominated'
                ? `${reasonLabels[reason]} (${dominatedBy.length})`
                : reason === 'lowPotential'
                  ? `${reasonLabels[reason]} (最大 ${Math.round(maxEfficiency * 100)}%)`
                  : reasonLabels[reason]
            }
          />
        ))}
      </Box>
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
    </Stack>
  )
}
