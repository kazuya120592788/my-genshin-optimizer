import { allSubstatKeys } from '@genshin-optimizer/gi/consts'
import type { CharacterInsight } from './characters'
import type { JunkConfig } from './junkArtifacts'
import { defaultJunkConfig } from './junkArtifacts'
import type { ArtifactProfile } from './profiles'
import { junkProfiles } from './profiles'

/** 不要聖遺物チェッカーの設定を保存する localStorage のキー */
export const junkConfigStorageKey = 'gi_page_my_junk_config'
/** 「所持キャラの型」で判定から外したキャラを保存する localStorage のキー */
export const junkExcludedCharsStorageKey = 'gi_page_junk_excluded_chars'

/** 保存された設定を読む。壊れていれば初期値に戻す */
export function parseJunkConfig(raw: unknown): JunkConfig {
  if (typeof raw !== 'object' || raw === null) return defaultJunkConfig
  const parsed = raw as Partial<JunkConfig>
  return {
    ...defaultJunkConfig,
    ...parsed,
    mode:
      parsed.mode === 'single' || parsed.mode === 'characters'
        ? parsed.mode
        : 'allProfiles',
    profileIds: (Array.isArray(parsed.profileIds)
      ? parsed.profileIds
      : defaultJunkConfig.profileIds
    ).filter((id) => junkProfiles.some((p) => p.id === id)),
    usefulSubstats: (Array.isArray(parsed.usefulSubstats)
      ? parsed.usefulSubstats
      : []
    ).filter((k) => allSubstatKeys.includes(k)),
  }
}

export function parseExcludedChars(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((k) => typeof k === 'string') : []
}

function readStorage(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

export function loadJunkConfig() {
  return parseJunkConfig(readStorage(junkConfigStorageKey))
}
export function loadJunkExcludedChars() {
  return parseExcludedChars(readStorage(junkExcludedCharsStorageKey))
}

export type ResolvedJunkProfile = ArtifactProfile & { id: string }

/** 設定の判定のしかたに合わせて、判定に使う型を並べる */
export function resolveJunkProfiles(
  config: JunkConfig,
  insights: readonly CharacterInsight[],
  excludedChars: readonly string[]
): ResolvedJunkProfile[] {
  if (config.mode === 'single')
    return [{ id: 'custom', keys: config.usefulSubstats }]
  if (config.mode === 'characters')
    return insights
      .filter(({ key }) => !excludedChars.includes(key))
      .map(({ key, profile }) => ({ id: key, ...profile }))
  return junkProfiles.filter(({ id }) => config.profileIds.includes(id))
}
