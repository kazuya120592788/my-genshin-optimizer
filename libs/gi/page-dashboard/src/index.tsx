import {
  useDataManagerEntries,
  useDataManagerValues,
} from '@genshin-optimizer/common/database-ui'
import { CardThemed, ImgIcon } from '@genshin-optimizer/common/ui'
import type { CharacterInsight } from '@genshin-optimizer/gi/artifact-insight'
import {
  findJunkArtifacts,
  getUsedSetKeys,
  isMainStatUseful,
  loadJunkConfig,
  loadJunkExcludedChars,
  pieceScore,
  resolveJunkProfiles,
  substatShortNames,
  useCharacterInsights,
  useDomainRecommendations,
} from '@genshin-optimizer/gi/artifact-insight'
import { artifactDefIcon } from '@genshin-optimizer/gi/assets'
import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  CharacterKey,
} from '@genshin-optimizer/gi/consts'
import { allArtifactSlotKeys } from '@genshin-optimizer/gi/consts'
import type { ICachedArtifact } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import {
  ArtifactSetName,
  ArtifactSlotName,
  CharacterName,
  CharIconSide,
} from '@genshin-optimizer/gi/ui'
import {
  Box,
  Button,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import type { OptimizerGap } from './useOptimizerGaps'
import { useOptimizerGaps } from './useOptimizerGaps'

const percent = (v: number) => `${Math.round(v * 100)}%`

/** 最適化結果がこれ以上伸びるなら「次にやること」に出す */
const MIN_GAP = 0.01

/** キャラごとの装備の状態 */
interface CharacterRow {
  insight: CharacterInsight
  /** 装備中の数 */
  equippedCount: number
  /** セットごとの装備数（多い順） */
  sets: Array<[ArtifactSetKey, number]>
  /** 部位ごとの強さ（+20 時の Roll Value の見込み、メインが合わなければ 0） */
  scores: Partial<Record<ArtifactSlotKey, number>>
  totalScore: number
  /** メインが型に合わない部位 */
  badMainSlots: ArtifactSlotKey[]
  emptySlots: ArtifactSlotKey[]
  weakestSlot?: ArtifactSlotKey
  /** 最適化結果との差（一番大きいチーム） */
  gap?: OptimizerGap
}

function gapRatio(gap: OptimizerGap) {
  return gap.best / gap.current - 1
}

export default function PageDashboard() {
  const database = useDatabase()
  const arts = useDataManagerValues(database.arts)
  const buildEntries = useDataManagerEntries(database.builds)
  const insights = useCharacterInsights()
  const { gaps, done: gapsDone } = useOptimizerGaps()
  const domains = useDomainRecommendations(insights, { samples: 150 })

  const artStats = useMemo(() => {
    const five = arts.filter((a) => a.rarity === 5)
    return {
      total: arts.length,
      fiveMax: five.filter((a) => a.level === 20).length,
      fiveFresh: five.filter((a) => a.level === 0).length,
      locked: arts.filter((a) => a.lock).length,
      equipped: arts.filter((a) => a.location).length,
    }
  }, [arts])

  // 不要聖遺物チェッカーと同じ設定で数える
  const junkCount = useMemo(() => {
    const config = loadJunkConfig()
    const profiles = resolveJunkProfiles(
      config,
      insights,
      loadJunkExcludedChars()
    )
    if (!profiles.length) return 0
    const buildArts = buildEntries.map(([, { artifactIds }]) =>
      Object.values(artifactIds)
        .map((id) => (id ? database.arts.get(id) : undefined))
        .filter((a): a is ICachedArtifact => !!a)
    )
    const usedInBuildIds = new Set(buildArts.flat().map(({ id }) => id))
    return findJunkArtifacts(arts, usedInBuildIds, config, {
      profiles,
      usedSetKeys: getUsedSetKeys(insights, buildArts),
    }).length
  }, [arts, buildEntries, insights, database])

  const rows = useMemo<CharacterRow[]>(() => {
    return insights
      .map((insight) => {
        const { equipped, profile, key } = insight
        const scores: CharacterRow['scores'] = {}
        const badMainSlots: ArtifactSlotKey[] = []
        const emptySlots: ArtifactSlotKey[] = []
        const setCounts = new Map<ArtifactSetKey, number>()
        for (const slot of allArtifactSlotKeys) {
          const art = equipped[slot]
          if (!art) {
            emptySlots.push(slot)
            continue
          }
          scores[slot] = pieceScore(art, profile)
          if (!isMainStatUseful(slot, art.mainStatKey, profile))
            badMainSlots.push(slot)
          setCounts.set(art.setKey, (setCounts.get(art.setKey) ?? 0) + 1)
        }
        const weakestSlot = allArtifactSlotKeys
          .filter((s) => scores[s] !== undefined)
          .reduce<ArtifactSlotKey | undefined>(
            (min, s) =>
              min === undefined || scores[s]! < scores[min]! ? s : min,
            undefined
          )
        const gap = gaps
          .filter((g) => g.charKey === key)
          .reduce<OptimizerGap | undefined>(
            (max, g) => (!max || gapRatio(g) > gapRatio(max) ? g : max),
            undefined
          )
        return {
          insight,
          equippedCount: allArtifactSlotKeys.length - emptySlots.length,
          sets: [...setCounts].sort((a, b) => b[1] - a[1]),
          scores,
          totalScore: Object.values(scores).reduce((s, v) => s + v, 0),
          badMainSlots,
          emptySlots,
          weakestSlot,
          gap,
        }
      })
      .sort(
        (a, b) =>
          (b.gap ? gapRatio(b.gap) : 0) - (a.gap ? gapRatio(a.gap) : 0) ||
          a.totalScore - b.totalScore
      )
  }, [insights, gaps])

  return (
    <Stack spacing={1} sx={{ my: 1 }}>
      <CardThemed>
        <CardHeader
          title="マイダッシュボード"
          subheader="手持ちの聖遺物とキャラの状態をまとめて、次にやることを提案します。"
        />
        <Divider />
        <CardContent>
          <Grid container spacing={1} columns={{ xs: 2, sm: 3, md: 6 }}>
            <StatTile label="聖遺物" value={artStats.total} />
            <StatTile label="星5 +20" value={artStats.fiveMax} />
            <StatTile label="星5 未強化" value={artStats.fiveFresh} />
            <StatTile label="ロック中" value={artStats.locked} />
            <StatTile label="装備中" value={artStats.equipped} />
            <StatTile label="不要候補" value={junkCount} to="/junk-artifacts" />
          </Grid>
        </CardContent>
      </CardThemed>

      <NextActions
        rows={rows}
        gapsDone={gapsDone}
        junkCount={junkCount}
        domains={domains}
      />

      <CardThemed>
        <CardHeader
          title="キャラごとの装備"
          subheader="最適化結果との差が大きい順（差がわからないキャラは Roll Value が小さい順）"
        />
        <Divider />
        <CharacterTable rows={rows} gapsDone={gapsDone} />
      </CardThemed>
    </Stack>
  )
}

function StatTile({
  label,
  value,
  to,
}: {
  label: string
  value: number
  to?: string
}) {
  const body = (
    <Box textAlign="center" py={1}>
      <Typography variant="h5">{value.toLocaleString()}</Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  )
  return (
    <Grid item xs={1}>
      <CardThemed bgt="light" sx={{ height: '100%' }}>
        {to ? (
          <Link component={RouterLink} to={to} underline="none" color="inherit">
            {body}
          </Link>
        ) : (
          body
        )}
      </CardThemed>
    </Grid>
  )
}

function NextActions({
  rows,
  gapsDone,
  junkCount,
  domains,
}: {
  rows: CharacterRow[]
  gapsDone: boolean
  junkCount: number
  domains: ReturnType<typeof useDomainRecommendations>
}) {
  const { gender } = useDBMeta()
  const name = (key: CharacterKey) => (
    <>
      <CharIconSide characterKey={key} />
      <CharacterName characterKey={key} gender={gender} />
    </>
  )
  const actions: Array<{ key: string; body: ReactNode; to?: string }> = []

  for (const row of rows
    .filter((r) => r.gap && gapRatio(r.gap) >= MIN_GAP)
    .slice(0, 3)) {
    const gap = row.gap!
    actions.push({
      key: `gap-${gap.teamId}`,
      body: (
        <>
          {name(gap.charKey)} を最適化結果の装備に変えると{' '}
          <strong>+{(gapRatio(gap) * 100).toFixed(1)}%</strong>
        </>
      ),
      to: `/teams/${gap.teamId}/${gap.charKey}/optimize`,
    })
  }
  for (const row of rows.filter((r) => r.badMainSlots.length).slice(0, 3))
    actions.push({
      key: `main-${row.insight.key}`,
      body: (
        <>
          {name(row.insight.key)} の{' '}
          {row.badMainSlots.map((s, i) => (
            <span key={s}>
              {i > 0 && '・'}
              <ArtifactSlotName slotKey={s} />
            </span>
          ))}{' '}
          はメインステータスが型に合っていません
        </>
      ),
      to: `/characters/${row.insight.key}`,
    })
  for (const row of rows.filter((r) => r.emptySlots.length).slice(0, 3))
    actions.push({
      key: `empty-${row.insight.key}`,
      body: (
        <>
          {name(row.insight.key)} は聖遺物が {row.emptySlots.length}{' '}
          部位空いています
        </>
      ),
      to: `/characters/${row.insight.key}`,
    })
  if (junkCount)
    actions.push({
      key: 'junk',
      body: (
        <>
          不要候補の聖遺物が <strong>{junkCount}</strong> 個あります
        </>
      ),
      to: '/junk-artifacts',
    })

  return (
    <CardThemed>
      <CardHeader title="次にやること" />
      <Divider />
      <CardContent>
        <Stack spacing={1}>
          {!gapsDone && (
            <Box display="flex" gap={1} alignItems="center">
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">
                最適化結果との差を計算しています…
              </Typography>
            </Box>
          )}
          {actions.map(({ key, body, to }) => (
            <Box
              key={key}
              display="flex"
              gap={1}
              alignItems="center"
              justifyContent="space-between"
            >
              <Typography component="div">{body}</Typography>
              {to && (
                <Button component={RouterLink} to={to} size="small">
                  開く
                </Button>
              )}
            </Box>
          ))}
          <Box>
            <Box
              display="flex"
              gap={1}
              alignItems="center"
              justifyContent="space-between"
            >
              <Typography>おすすめの周回先</Typography>
              <Button component={RouterLink} to="/farming" size="small">
                くわしく
              </Button>
            </Box>
            {!domains ? (
              <CircularProgress size={16} />
            ) : (
              <Box display="flex" gap={1} flexWrap="wrap">
                {domains.slice(0, 3).map(({ domain, gainPerRun }, i) => (
                  <Chip
                    key={domain.id}
                    sx={{
                      height: 'auto',
                      maxWidth: '100%',
                      '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 },
                    }}
                    label={
                      <Box
                        display="flex"
                        gap={0.5}
                        alignItems="center"
                        flexWrap="wrap"
                      >
                        {i + 1}.
                        {domain.sets.map((s) => (
                          <ImgIcon key={s} src={artifactDefIcon(s)} />
                        ))}
                        <ArtifactSetName setKey={domain.sets[0]} />
                        {domain.sets[1] && (
                          <>
                            ・<ArtifactSetName setKey={domain.sets[1]} />
                          </>
                        )}{' '}
                        +{(gainPerRun * 100).toFixed(1)}%/回
                      </Box>
                    }
                  />
                ))}
              </Box>
            )}
          </Box>
          {gapsDone && !actions.length && (
            <Typography color="text.secondary">
              いまのところ、すぐにやることはありません。
            </Typography>
          )}
        </Stack>
      </CardContent>
    </CardThemed>
  )
}

function CharacterTable({
  rows,
  gapsDone,
}: {
  rows: CharacterRow[]
  gapsDone: boolean
}) {
  const { gender } = useDBMeta()
  if (!rows.length)
    return (
      <CardContent>
        <Typography color="text.secondary">
          聖遺物を装備しているキャラがいません。
        </Typography>
      </CardContent>
    )
  return (
    <TableContainer>
      <Table size="small" sx={{ minWidth: 760 }}>
        <TableHead>
          <TableRow>
            <TableCell>キャラ</TableCell>
            <TableCell>型</TableCell>
            <TableCell>セット</TableCell>
            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
              Roll Value 合計
            </TableCell>
            <TableCell>弱い部位</TableCell>
            <TableCell align="right">最適化結果との差</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const { insight, sets, totalScore, weakestSlot, scores, gap } = row
            return (
              <TableRow key={insight.key}>
                <TableCell>
                  <Link
                    component={RouterLink}
                    to={`/characters/${insight.key}`}
                    color="inherit"
                    underline="hover"
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                  >
                    <CharIconSide characterKey={insight.key} />
                    <CharacterName characterKey={insight.key} gender={gender} />
                  </Link>
                </TableCell>
                <TableCell>
                  {insight.profile.keys
                    .map((k) => substatShortNames[k])
                    .join('・')}
                </TableCell>
                <TableCell>
                  {sets.map(([setKey, count]) => (
                    <Box
                      key={setKey}
                      display="flex"
                      gap={0.5}
                      alignItems="center"
                    >
                      <ImgIcon src={artifactDefIcon(setKey)} />
                      <Typography variant="body2">
                        <ArtifactSetName setKey={setKey} /> ×{count}
                      </Typography>
                    </Box>
                  ))}
                  {row.emptySlots.length > 0 && (
                    <Typography variant="body2" color="warning.main">
                      空き {row.emptySlots.length}
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="right">{percent(totalScore)}</TableCell>
                <TableCell>
                  {weakestSlot && (
                    <Typography
                      variant="body2"
                      color={
                        row.badMainSlots.includes(weakestSlot)
                          ? 'error'
                          : undefined
                      }
                    >
                      <ArtifactSlotName slotKey={weakestSlot} />（
                      {row.badMainSlots.includes(weakestSlot)
                        ? 'メインが合わない'
                        : percent(scores[weakestSlot]!)}
                      ）
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="right">
                  {gap ? (
                    <Link
                      component={RouterLink}
                      to={`/teams/${gap.teamId}/${gap.charKey}/optimize`}
                      underline="hover"
                    >
                      +{(gapRatio(gap) * 100).toFixed(1)}%
                    </Link>
                  ) : gapsDone ? (
                    <Typography variant="body2" color="text.secondary">
                      —
                    </Typography>
                  ) : (
                    <CircularProgress size={12} />
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <Box px={2} py={1}>
        <Typography variant="caption" color="text.secondary">
          Roll Value は装備中の聖遺物の有効サブステの合計（強化途中の星5は +20
          にしたときの期待値、メインが型に合わない部位は
          0）です。最適化結果との差は、チーム画面で最適化した結果の1位の装備にしたとき、最適化ターゲットの値が今よりどれだけ上がるかです（最適化していないキャラは「—」）。
        </Typography>
      </Box>
    </TableContainer>
  )
}
