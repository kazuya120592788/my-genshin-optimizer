import {
  useDataManagerEntries,
  useDataManagerValues,
} from '@genshin-optimizer/common/database-ui'
import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import type {
  ArtifactSlotKey,
  CharacterKey,
  MainStatKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import {
  allSubstatKeys,
  charKeyToLocCharKey,
} from '@genshin-optimizer/gi/consts'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { SlotIcon } from '@genshin-optimizer/gi/svgicons'
import {
  ArtifactCard,
  ArtifactEditor,
  CharacterName,
  CharIconSide,
} from '@genshin-optimizer/gi/ui'
import EditIcon from '@mui/icons-material/Edit'
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
  IconButton,
  MenuItem,
  Select,
  Slider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import type {
  ArtifactScore,
  CharacterAnalysis,
  SlotAnalysis,
  UpgradeConfig,
} from './upgradePotential'
import {
  analyzeUpgradePotential,
  defaultUpgradeConfig,
  guessProfileId,
  upgradeProfiles,
} from './upgradePotential'

const STORAGE_KEY = 'gi_page_upgrade_potential'
const PAGE_SIZE = 20

const substatShortNames: Record<SubstatKey, string> = {
  hp: 'HP',
  hp_: 'HP%',
  atk: '攻撃',
  atk_: '攻撃%',
  def: '防御',
  def_: '防御%',
  eleMas: '熟知',
  enerRech_: 'チャージ',
  critRate_: '会心率',
  critDMG_: '会心ダメ',
}

interface PageSettings extends UpgradeConfig {
  sort: 'gain' | 'weakest'
  onlyFavorites: boolean
  hideUnequipped: boolean
  /** キャラごとに手動で選んだ型（未指定なら自動判定） */
  profileOverrides: Record<string, string>
}

const defaultSettings: PageSettings = {
  ...defaultUpgradeConfig,
  sort: 'gain',
  onlyFavorites: false,
  hideUnequipped: true,
  profileOverrides: {},
}

function loadSettings(): PageSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSettings
    const parsed = JSON.parse(raw) as Partial<PageSettings>
    return {
      ...defaultSettings,
      ...parsed,
      sort: parsed.sort === 'weakest' ? 'weakest' : 'gain',
      profileOverrides: Object.fromEntries(
        Object.entries(parsed.profileOverrides ?? {}).filter(([, id]) =>
          upgradeProfiles.some((p) => p.id === id)
        )
      ),
    }
  } catch {
    return defaultSettings
  }
}

const pct = (v: number) => `${Math.round(v * 100)}%`
const profileById = (id: string) =>
  upgradeProfiles.find((p) => p.id === id) ?? upgradeProfiles[0]

type Suggestion = {
  characterKey: CharacterKey
  slot: SlotAnalysis
  kind: 'swap' | 'train'
  keys: readonly SubstatKey[]
}
type SuggestionTarget = {
  characterKey: CharacterKey
  slotKey: ArtifactSlotKey
  kind: 'swap' | 'train'
}

export default function PageUpgradePotential() {
  const database = useDatabase()
  const [settings, setSettingsState] = useState<PageSettings>(loadSettings)
  const setSettings = useCallback(
    (update: Partial<PageSettings>) =>
      setSettingsState((prev) => ({ ...prev, ...update })),
    []
  )
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // ストレージが使えない環境では保存しない
    }
  }, [settings])

  const arts = useDataManagerValues(database.arts)
  const chars = useDataManagerValues(database.chars)
  const charMetaEntries = useDataManagerEntries(database.charMeta)
  const favorites = useMemo(
    () =>
      new Set(
        charMetaEntries.filter(([, m]) => m.favorite).map(([key]) => key)
      ),
    [charMetaEntries]
  )

  // キャラごとの型（手動指定がなければ装備のメインステから推測）
  const targets = useMemo(() => {
    const artsById = new Map(arts.map((a) => [a.id, a]))
    const seenLocations = new Set<string>()
    return chars.flatMap((char) => {
      const location = charKeyToLocCharKey(char.key)
      // 旅人は元素ごとにデータがあるが聖遺物は共通なので1人だけ表示する
      if (seenLocations.has(location)) return []
      seenLocations.add(location)
      const mainStats: Partial<Record<ArtifactSlotKey, MainStatKey>> = {}
      for (const [slotKey, id] of Object.entries(char.equippedArtifacts)) {
        const art = id ? artsById.get(id) : undefined
        if (art) mainStats[slotKey as ArtifactSlotKey] = art.mainStatKey
      }
      const autoProfileId = guessProfileId(mainStats)
      const profileId = settings.profileOverrides[char.key] ?? autoProfileId
      return [
        {
          characterKey: char.key,
          location,
          equippedArtifacts: char.equippedArtifacts,
          keys: profileById(profileId).keys,
          profileId,
          autoProfileId,
          isAuto: !settings.profileOverrides[char.key],
        },
      ]
    })
  }, [arts, chars, settings.profileOverrides])

  const analyses = useMemo(() => {
    const filtered = targets.filter(
      (t) =>
        (!settings.onlyFavorites || favorites.has(t.characterKey)) &&
        (!settings.hideUnequipped ||
          Object.values(t.equippedArtifacts).some(Boolean))
    )
    const results = analyzeUpgradePotential(arts, filtered, settings)
    const byKey = new Map<string, (typeof filtered)[number]>(
      filtered.map((t) => [t.characterKey, t])
    )
    return results
      .map((analysis) => ({
        analysis,
        target: byKey.get(analysis.characterKey)!,
      }))
      .sort(({ analysis: a }, { analysis: b }) =>
        settings.sort === 'gain'
          ? b.totalGain - a.totalGain || a.totalCurrent - b.totalCurrent
          : a.totalCurrent - b.totalCurrent || b.totalGain - a.totalGain
      )
  }, [arts, targets, favorites, settings])

  const [limit, setLimit] = useState(PAGE_SIZE)
  useEffect(() => setLimit(PAGE_SIZE), [settings])
  const [suggestionTarget, setSuggestionTarget] = useState<SuggestionTarget>()
  // 聖遺物を編集したら最新の分析結果で表示し直すため、開いている候補は毎回引き直す
  const suggestion = useMemo<Suggestion | undefined>(() => {
    if (!suggestionTarget) return undefined
    const found = analyses.find(
      ({ analysis }) => analysis.characterKey === suggestionTarget.characterKey
    )
    const slot = found?.analysis.slots.find(
      (s) => s.slotKey === suggestionTarget.slotKey
    )
    if (!found || !slot) return undefined
    return {
      characterKey: suggestionTarget.characterKey,
      slot,
      kind: suggestionTarget.kind,
      keys: found.target.keys,
    }
  }, [analyses, suggestionTarget])
  const [artifactIdToEdit, setArtifactIdToEdit] = useState<string>()

  return (
    <Stack spacing={1} sx={{ my: 1 }}>
      <Suspense fallback={false}>
        <ArtifactEditor
          artifactIdToEdit={artifactIdToEdit}
          cancelEdit={() => setArtifactIdToEdit(undefined)}
        />
      </Suspense>
      {suggestionTarget && (
        <SuggestionModal
          suggestion={suggestion}
          onEdit={setArtifactIdToEdit}
          onClose={() => setSuggestionTarget(undefined)}
        />
      )}
      <CardThemed>
        <CardHeader
          title="聖遺物の伸びしろ"
          subheader="装備中の聖遺物の強化・入れ替えで、どのキャラがどれくらい伸びるかを一覧表示します。聖遺物を厳選・強化するキャラを決めるときに使ってください。"
        />
        <Divider />
        <CardContent>
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                並び順
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                color="primary"
                value={settings.sort}
                onChange={(_, sort) => sort && setSettings({ sort })}
              >
                <ToggleButton value="gain">伸びしろが大きい順</ToggleButton>
                <ToggleButton value="weakest">
                  Roll Value の合計が低い順
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <Box>
              <Typography variant="subtitle1">
                提案する伸びの下限: Roll Value +{pct(settings.minGain)} 以上
              </Typography>
              <Box px={2} maxWidth={480}>
                <Slider
                  size="small"
                  value={settings.minGain}
                  min={0.5}
                  max={4}
                  step={0.5}
                  marks
                  valueLabelDisplay="auto"
                  valueLabelFormat={pct}
                  onChange={(_, v) => setSettings({ minGain: v as number })}
                />
              </Box>
              <Typography variant="caption" color="text.secondary">
                Roll Value
                は聖遺物カードと同じで、キャラの型の有効サブステだけを数えます（星5の最大値1回分
                =
                100%）。強化の伸びは、残りの強化が4つのサブステに均等に入るとみなした期待値です。
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle1">候補にする聖遺物</Typography>
              <Box display="flex" flexWrap="wrap">
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={settings.allowOtherSets}
                      onChange={(_, allowOtherSets) =>
                        setSettings({ allowOtherSets })
                      }
                    />
                  }
                  label="セットが違うもの（セット効果が崩れることがあります）"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={settings.includeEquippedByOthers}
                      onChange={(_, includeEquippedByOthers) =>
                        setSettings({ includeEquippedByOthers })
                      }
                    />
                  }
                  label="ほかのキャラが装備中のもの"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={settings.countEmptySlots}
                      onChange={(_, countEmptySlots) =>
                        setSettings({ countEmptySlots })
                      }
                    />
                  }
                  label="未装備の部位の伸びも伸びしろに数える"
                />
              </Box>
              <Typography variant="caption" color="text.secondary">
                部位とメインステータスが同じで、レア度が同じか上の聖遺物だけを比べます。未装備の部位には、部位が同じ星5の聖遺物を提案します。
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle1">表示するキャラ</Typography>
              <Box display="flex" flexWrap="wrap">
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={settings.onlyFavorites}
                      onChange={(_, onlyFavorites) =>
                        setSettings({ onlyFavorites })
                      }
                    />
                  }
                  label="お気に入りのみ"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={settings.hideUnequipped}
                      onChange={(_, hideUnequipped) =>
                        setSettings({ hideUnequipped })
                      }
                    />
                  }
                  label="聖遺物を装備していないキャラを除く"
                />
              </Box>
            </Box>
            <Box>
              <Button
                size="small"
                color="secondary"
                onClick={() => setSettingsState(defaultSettings)}
              >
                設定を初期値に戻す（キャラの型の指定も戻ります）
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </CardThemed>

      {!analyses.length && (
        <Alert severity="info">表示できるキャラがいません。</Alert>
      )}

      <Grid container spacing={1} columns={{ xs: 1, lg: 2 }}>
        {analyses.slice(0, limit).map(({ analysis, target }, i) => (
          <Grid item xs={1} key={analysis.characterKey}>
            <CharacterItem
              rank={i + 1}
              analysis={analysis}
              profileId={target.profileId}
              autoProfileId={target.autoProfileId}
              isAuto={target.isAuto}
              onProfileChange={(id) =>
                setSettingsState((prev) => {
                  const profileOverrides = { ...prev.profileOverrides }
                  if (id) profileOverrides[analysis.characterKey] = id
                  else delete profileOverrides[analysis.characterKey]
                  return { ...prev, profileOverrides }
                })
              }
              onSuggestionClick={(slot, kind) =>
                setSuggestionTarget({
                  characterKey: analysis.characterKey as CharacterKey,
                  slotKey: slot.slotKey,
                  kind,
                })
              }
              onEdit={setArtifactIdToEdit}
            />
          </Grid>
        ))}
      </Grid>
      {analyses.length > limit && (
        <Button onClick={() => setLimit((l) => l + PAGE_SIZE)}>
          さらに表示（残り {analyses.length - limit} 人）
        </Button>
      )}
    </Stack>
  )
}

function CharacterItem({
  rank,
  analysis,
  profileId,
  autoProfileId,
  isAuto,
  onProfileChange,
  onSuggestionClick,
  onEdit,
}: {
  rank: number
  analysis: CharacterAnalysis
  profileId: string
  autoProfileId: string
  isAuto: boolean
  onProfileChange: (id: string | undefined) => void
  onSuggestionClick: (slot: SlotAnalysis, kind: 'swap' | 'train') => void
  onEdit: (artifactId: string) => void
}) {
  const { gender } = useDBMeta()
  const characterKey = analysis.characterKey as CharacterKey
  const profile = profileById(profileId)
  return (
    <CardThemed sx={{ height: '100%' }}>
      <CardContent>
        <Stack spacing={1}>
          <Box
            display="flex"
            gap={1}
            flexWrap="wrap"
            alignItems="center"
            justifyContent="space-between"
          >
            <Box display="flex" gap={1} alignItems="center">
              <Typography color="text.secondary">{rank}.</Typography>
              <Typography
                component={RouterLink}
                to={`/characters/${characterKey}`}
                sx={{ color: 'inherit', textDecoration: 'none' }}
              >
                <CharIconSide characterKey={characterKey} />{' '}
                <strong>
                  <CharacterName characterKey={characterKey} gender={gender} />
                </strong>
              </Typography>
            </Box>
            <Select
              size="small"
              value={isAuto ? '' : profileId}
              displayEmpty
              onChange={(e) => onProfileChange(e.target.value || undefined)}
            >
              <MenuItem value="">
                自動（{profileById(autoProfileId).label}）
              </MenuItem>
              {upgradeProfiles.map(({ id, label, keys }) => (
                <MenuItem key={id} value={id}>
                  {label}（{keys.map((k) => substatShortNames[k]).join('・')}）
                </MenuItem>
              ))}
            </Select>
          </Box>
          <Box display="flex" gap={1} flexWrap="wrap" alignItems="center">
            <Chip
              size="small"
              color={analysis.totalGain >= 1 ? 'success' : 'default'}
              label={`伸びしろ +${pct(analysis.totalGain)}`}
            />
            <Chip
              size="small"
              variant="outlined"
              label={`現在の合計 ${pct(analysis.totalCurrent)}`}
            />
            {analysis.emptySlots > 0 && (
              <Chip
                size="small"
                color="warning"
                label={`未装備 ${analysis.emptySlots} 部位`}
              />
            )}
            <Typography variant="caption" color="text.secondary">
              有効: {profile.keys.map((k) => substatShortNames[k]).join('・')}
            </Typography>
          </Box>
          <Divider />
          {analysis.slots.map((slot) => (
            <SlotRow
              key={slot.slotKey}
              slot={slot}
              onSuggestionClick={(kind) => onSuggestionClick(slot, kind)}
              onEdit={onEdit}
            />
          ))}
        </Stack>
      </CardContent>
    </CardThemed>
  )
}

function SlotRow({
  slot,
  onSuggestionClick,
  onEdit,
}: {
  slot: SlotAnalysis
  onSuggestionClick: (kind: 'swap' | 'train') => void
  onEdit: (artifactId: string) => void
}) {
  const { equipped, swap, train, levelUpGain } = slot
  return (
    <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
      <SlotIcon slotKey={slot.slotKey} iconProps={{ fontSize: 'small' }} />
      <Typography variant="body2" sx={{ minWidth: 120 }}>
        {equipped ? (
          <>
            {pct(equipped.current)}
            <Typography
              component="span"
              variant="caption"
              color="text.secondary"
            >
              {' '}
              / 最大 {pct(equipped.max)}
            </Typography>
          </>
        ) : (
          <Typography component="span" variant="body2" color="warning.main">
            未装備
          </Typography>
        )}
      </Typography>
      {equipped && (
        <IconButton
          size="small"
          title="装備中の聖遺物を編集"
          aria-label="装備中の聖遺物を編集"
          onClick={() => onEdit(equipped.id)}
        >
          <EditIcon fontSize="small" />
        </IconButton>
      )}
      {equipped && equipped.rollsRemaining > 0 && levelUpGain > 0 && (
        <Chip
          size="small"
          color="info"
          label={`強化 +${pct(levelUpGain)}（残り${equipped.rollsRemaining}回）`}
        />
      )}
      {swap && (
        <Chip
          size="small"
          color="success"
          label={`入れ替え +${pct(swap.gain)}`}
          onClick={() => onSuggestionClick('swap')}
        />
      )}
      {train && (
        <Chip
          size="small"
          color="secondary"
          label={`育成候補 +${pct(train.gain)}`}
          onClick={() => onSuggestionClick('train')}
        />
      )}
    </Box>
  )
}

function SuggestionModal({
  suggestion,
  onEdit,
  onClose,
}: {
  suggestion?: Suggestion
  onEdit: (artifactId: string) => void
  onClose: () => void
}) {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const keys = suggestion?.keys
  const effFilter = useMemo(
    () => new Set<SubstatKey>(keys?.length ? keys : allSubstatKeys),
    [keys]
  )
  const candidate = (
    suggestion?.kind === 'swap' ? suggestion.slot.swap : suggestion?.slot.train
  ) as (ArtifactScore & { gain: number }) | undefined
  if (!suggestion || !candidate)
    return (
      <ModalWrapper open onClose={onClose}>
        <CardThemed>
          <CardContent>
            <Alert severity="info">
              聖遺物が変わったため、この候補はなくなりました。
            </Alert>
            <Box display="flex" justifyContent="flex-end" mt={1}>
              <Button color="secondary" onClick={onClose}>
                閉じる
              </Button>
            </Box>
          </CardContent>
        </CardThemed>
      </ModalWrapper>
    )
  const { characterKey, slot, kind } = suggestion
  const equip = () => {
    database.arts.set(candidate.id, {
      location: charKeyToLocCharKey(characterKey),
    })
    onClose()
  }
  return (
    <ModalWrapper open onClose={onClose}>
      <CardThemed>
        <CardHeader
          title={
            <>
              <CharacterName characterKey={characterKey} gender={gender} /> の
              {kind === 'swap' ? '入れ替え候補' : '育成候補'}
            </>
          }
          subheader={
            kind === 'swap'
              ? `入れ替えると Roll Value が +${pct(candidate.gain)} 伸びます。`
              : `+20 まで強化すると Roll Value が ${pct(candidate.expected)}（最大 ${pct(candidate.max)}）になる見込みで、ほかの方法より +${pct(candidate.gain)} 伸びる見込みです。`
          }
        />
        <Divider />
        <CardContent>
          <Grid container spacing={1} columns={{ xs: 1, sm: 2 }}>
            <Grid item xs={1}>
              <Typography gutterBottom>装備中</Typography>
              {slot.equipped ? (
                <Box>
                  <ArtifactCard
                    artifactId={slot.equipped.id}
                    effFilter={effFilter}
                    onEdit={() => slot.equipped && onEdit(slot.equipped.id)}
                  />
                </Box>
              ) : (
                <Alert severity="warning">未装備</Alert>
              )}
            </Grid>
            <Grid item xs={1}>
              <Typography gutterBottom>候補</Typography>
              <Box>
                <ArtifactCard
                  artifactId={candidate.id}
                  effFilter={effFilter}
                  onEdit={() => onEdit(candidate.id)}
                  onLockToggle={() =>
                    database.arts.set(candidate.id, ({ lock }) => ({
                      lock: !lock,
                    }))
                  }
                />
              </Box>
            </Grid>
          </Grid>
          <Box display="flex" gap={1} justifyContent="flex-end" mt={1}>
            <Button color="secondary" onClick={onClose}>
              閉じる
            </Button>
            <Button variant="contained" onClick={equip}>
              候補を装備する
            </Button>
          </Box>
        </CardContent>
      </CardThemed>
    </ModalWrapper>
  )
}
