import { CardThemed, ImgIcon } from '@genshin-optimizer/common/ui'
import type {
  CharacterInsight,
  DomainFarmingResult,
} from '@genshin-optimizer/gi/artifact-insight'
import {
  fiveStarDropsPerRun,
  substatShortNames,
  useCharacterInsights,
  useDomainRecommendations,
} from '@genshin-optimizer/gi/artifact-insight'
import { artifactDefIcon } from '@genshin-optimizer/gi/assets'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import {
  ArtifactSetName,
  CharacterName,
  CharIconSide,
} from '@genshin-optimizer/gi/ui'
import {
  Alert,
  Box,
  Button,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  Divider,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'

const EXCLUDED_CHARS_KEY = 'gi_page_farming_excluded_chars'
const SHOW_STEP = 8

function loadExcluded(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(EXCLUDED_CHARS_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((k) => typeof k === 'string')
      : []
  } catch {
    return []
  }
}

export default function PageFarming() {
  const allInsights = useCharacterInsights()
  const [excluded, setExcluded] = useState<string[]>(loadExcluded)
  useEffect(() => {
    try {
      localStorage.setItem(EXCLUDED_CHARS_KEY, JSON.stringify(excluded))
    } catch {
      // ストレージが使えない環境では保存しない
    }
  }, [excluded])
  const insights = useMemo(
    () => allInsights.filter(({ key }) => !excluded.includes(key)),
    [allInsights, excluded]
  )
  const results = useDomainRecommendations(insights)
  const [shown, setShown] = useState(SHOW_STEP)
  const top = results?.[0]?.gainPerRun ?? 0

  return (
    <Stack spacing={1} sx={{ my: 1 }}>
      <CardThemed>
        <CardHeader
          title="周回先のおすすめ"
          subheader="手持ちの聖遺物とキャラの型から、どの秘境を周回すると聖遺物が一番良くなるかを見積もります。"
        />
        <Divider />
        <CardContent>
          <Stack spacing={2}>
            <CharacterFilter
              insights={allInsights}
              excluded={excluded}
              setExcluded={setExcluded}
            />
            <Typography variant="caption" color="text.secondary">
              見積もりのしかた: 秘境1回（樹脂20）で星5聖遺物が平均{' '}
              {fiveStarDropsPerRun}{' '}
              個、2つのセットが半分ずつ出るものとして、ゲームと同じ確率で部位・メインステータス・サブステータスを決めた
              +20
              の聖遺物を何百個も作ります。それぞれを「メインステータスが型に合い、セット効果を崩さずに入れ替えられるキャラ」のうち一番伸びるキャラに装備させたときの、有効サブステの
              Roll Value（星5の最大値1回分 = 100%）の伸びを平均しています。
              ダメージそのものではなく Roll Value
              で比べているので、目安として使ってください。
            </Typography>
          </Stack>
        </CardContent>
      </CardThemed>

      {!insights.length && (
        <Alert severity="info">
          型を推定できるキャラがいません。キャラに聖遺物を装備させると、周回先を見積もれます。
        </Alert>
      )}
      {!!insights.length && !results && (
        <Box display="flex" justifyContent="center" p={2}>
          <CircularProgress />
        </Box>
      )}
      {results?.slice(0, shown).map((result, i) => (
        <DomainCard
          key={result.domain.id}
          rank={i + 1}
          result={result}
          ratio={top ? result.gainPerRun / top : 0}
        />
      ))}
      {results && results.length > shown && (
        <Button onClick={() => setShown((s) => s + SHOW_STEP)}>
          さらに表示（残り {results.length - shown} 件）
        </Button>
      )}
    </Stack>
  )
}

function CharacterFilter({
  insights,
  excluded,
  setExcluded,
}: {
  insights: CharacterInsight[]
  excluded: string[]
  setExcluded: (keys: string[]) => void
}) {
  const { gender } = useDBMeta()
  if (!insights.length) return null
  return (
    <Box>
      <Typography variant="subtitle1" gutterBottom>
        聖遺物を厳選するキャラ
      </Typography>
      <Box display="flex" gap={1} flexWrap="wrap">
        {insights.map(({ key, profile }) => {
          const selected = !excluded.includes(key)
          return (
            <Chip
              key={key}
              icon={<CharIconSide characterKey={key} />}
              label={
                <span>
                  <CharacterName characterKey={key} gender={gender} />（
                  {profile.keys.map((k) => substatShortNames[k]).join('・')}）
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
        型は装備中の時計・杯・冠のメインステータス（最適化画面でメインステータスを絞り込んでいればその設定）から推定しています。もう厳選しないキャラはチップを押して外してください。
      </Typography>
    </Box>
  )
}

function DomainCard({
  rank,
  result,
  ratio,
}: {
  rank: number
  result: DomainFarmingResult
  ratio: number
}) {
  const { gender } = useDBMeta()
  const { domain, gainPerRun, sets, beneficiaries } = result
  const total = beneficiaries.reduce((s, b) => s + b.gain, 0)
  return (
    <CardThemed>
      <CardContent>
        <Stack spacing={1}>
          <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
            <Typography variant="h6" color="text.secondary">
              {rank}
            </Typography>
            <Box flexGrow={1}>
              {sets.map(({ setKey, gainPerDrop }) => (
                <Box key={setKey} display="flex" gap={1} alignItems="center">
                  <ImgIcon src={artifactDefIcon(setKey)} size={2} />
                  <Typography>
                    <ArtifactSetName setKey={setKey} />
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    1つ出たら +{(gainPerDrop * 100).toFixed(0)}%
                  </Typography>
                </Box>
              ))}
              {domain.sets.length === 1 && (
                <Typography variant="caption" color="text.secondary">
                  同じ秘境のもう一方のセットは未登録のため、このセットの分だけで見積もっています。
                </Typography>
              )}
            </Box>
            <Box textAlign="right">
              <Typography variant="h6">
                +{(gainPerRun * 100).toFixed(1)}%
              </Typography>
              <Typography variant="caption" color="text.secondary">
                1回あたりの Roll Value
              </Typography>
            </Box>
          </Box>
          <LinearProgress variant="determinate" value={ratio * 100} />
          {!!beneficiaries.length && (
            <Box display="flex" gap={1} flexWrap="wrap" alignItems="center">
              <Typography variant="body2" color="text.secondary">
                伸びるキャラ:
              </Typography>
              {beneficiaries
                .filter(({ gain }) => gain / total >= 0.01)
                .slice(0, 5)
                .map(({ id, gain }) => (
                  <Chip
                    key={id}
                    size="small"
                    icon={<CharIconSide characterKey={id as CharacterKey} />}
                    label={
                      <span>
                        <CharacterName
                          characterKey={id as CharacterKey}
                          gender={gender}
                        />{' '}
                        {Math.round((gain / total) * 100)}%
                      </span>
                    }
                  />
                ))}
            </Box>
          )}
        </Stack>
      </CardContent>
    </CardThemed>
  )
}
