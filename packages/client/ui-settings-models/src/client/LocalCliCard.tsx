/**
 * Card for declaring a local external CLI model provider (Agy, Claude Code, Codex, Copilot, or Custom).
 *
 * @module @deepseek-ai/dsh-client-ui-settings-models/LocalCliCard
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { EditorFooter } from './EditorFooter.tsx'
import type { ModelsOperations } from './operations.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Settings namespace for external CLI provider. */
const NS = 'llm-external-cli'

/** Route identifier pattern. */
const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

type CliPresetKey = 'agy' | 'claude' | 'codex' | 'copilot' | 'custom'

interface PresetDef {
  key: CliPresetKey
  labelKey: keyof typeof en
  defaultRoute: string
  defaultDisplayName: string
  defaultCommand: string
  defaultArgs: string
}

const PRESETS: readonly PresetDef[] = [
  {
    key: 'agy',
    labelKey: 'cliPresetAgy',
    defaultRoute: 'agy',
    defaultDisplayName: 'Agy CLI',
    defaultCommand: 'agy',
    defaultArgs: '--print -',
  },
  {
    key: 'claude',
    labelKey: 'cliPresetClaude',
    defaultRoute: 'claude',
    defaultDisplayName: 'Claude Code CLI',
    defaultCommand: 'claude',
    defaultArgs: '--print',
  },
  {
    key: 'codex',
    labelKey: 'cliPresetCodex',
    defaultRoute: 'codex',
    defaultDisplayName: 'Codex CLI',
    defaultCommand: 'codex',
    defaultArgs: 'exec',
  },
  {
    key: 'copilot',
    labelKey: 'cliPresetCopilot',
    defaultRoute: 'copilot',
    defaultDisplayName: 'GitHub Copilot CLI',
    defaultCommand: 'copilot',
    defaultArgs: '',
  },
  {
    key: 'custom',
    labelKey: 'cliPresetCustom',
    defaultRoute: '',
    defaultDisplayName: '',
    defaultCommand: '',
    defaultArgs: '',
  },
]

/** Props of {@link LocalCliCard}. */
export interface LocalCliCardProps {
  /** Route ids already declared, so the card refuses to duplicate one. */
  taken: readonly string[]
  /** Revision of the user settings section when opened. */
  revision: number
  /** Host operations for settings mutation. */
  operations: ModelsOperations
  /** Section copy translation function. */
  t: (key: keyof typeof en) => string
  /** Disable writes when read-only. */
  readOnly: boolean
  /** Callback on dismiss or completion. */
  onClose: (changed: boolean) => void
  /** In-flight mutation busy reporter. */
  onBusyChange?: (busy: boolean) => void
}

/**
 * Render the Local CLI provider setup card.
 * @param props - Card options and callbacks.
 * @returns Card React node.
 */
export function LocalCliCard(props: LocalCliCardProps): ReactNode {
  const { taken, operations, t, onBusyChange } = props
  const [openedAt] = useState(() => props.revision)

  // Pick the first preset that is not already taken
  const fallbackPreset: PresetDef = PRESETS[0] ?? {
    key: 'agy',
    labelKey: 'cliPresetAgy',
    defaultRoute: 'agy',
    defaultDisplayName: 'Agy CLI',
    defaultCommand: 'agy',
    defaultArgs: '--print -',
  }
  const initialPreset = PRESETS.find(p => p.key !== 'custom' && !taken.includes(p.defaultRoute)) ?? fallbackPreset
  const [preset, setPreset] = useState<CliPresetKey>(initialPreset.key)
  const [route, setRoute] = useState(initialPreset.defaultRoute)
  const [displayName, setDisplayName] = useState(initialPreset.defaultDisplayName)
  const [command, setCommand] = useState(initialPreset.defaultCommand)
  const [args, setArgs] = useState(initialPreset.defaultArgs)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => { onBusyChange?.(busy) }, [busy, onBusyChange])

  const selectPreset = (nextKey: CliPresetKey): void => {
    setPreset(nextKey)
    const found = PRESETS.find(p => p.key === nextKey)
    if (found !== undefined && nextKey !== 'custom') {
      setRoute(found.defaultRoute)
      setDisplayName(found.defaultDisplayName)
      setCommand(found.defaultCommand)
      setArgs(found.defaultArgs)
    } else if (nextKey === 'custom') {
      setRoute('')
      setDisplayName('')
      setCommand('')
      setArgs('')
    }
  }

  const routeInvalid = route.length > 0 && !ROUTE_PATTERN.test(route)
  const routeTaken = taken.includes(route)
  const commandMissing = command.trim().length === 0
  const ready = route.length > 0 && !routeInvalid && !routeTaken && !commandMissing

  const hint = failure !== undefined || ready
    || route.length === 0 || routeInvalid || routeTaken
    ? undefined
    : commandMissing ? t('cliNeedsCommand') : undefined

  const create = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const parsedArgs = args.trim().length > 0 ? args.trim().split(/\s+/) : []
      const profile = {
        command: command.trim(),
        ...parsedArgs.length > 0 ? { args: parsedArgs } : {},
        ...displayName.trim().length > 0 ? { displayName: displayName.trim() } : {},
      }
      const written = await operations.writeSettings(
        NS,
        [{ op: 'set', path: ['providers', route], value: profile as JsonValue }],
        openedAt,
      )
      if (written.kind !== 'written') {
        setFailure(written.kind === 'conflict' ? t('conflict') : written.message)
        return
      }
      props.onClose(true)
    } finally {
      setBusy(false)
    }
  }

  const disabled = props.readOnly || busy

  return (
    <div className={styles['editor']}>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('cliPreset')}</span>
        <select
          className={`${styles['input']} ${styles['selectInput']}`}
          value={preset}
          aria-label={t('cliPreset')}
          disabled={disabled}
          onChange={(event) => { selectPreset(event.target.value as CliPresetKey) }}
        >
          {PRESETS.map(p => (
            <option key={p.key} value={p.key}>{t(p.labelKey)}</option>
          ))}
        </select>
      </div>

      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('cliRoute')}</span>
        <input
          className={styles['input']}
          type="text"
          value={route}
          placeholder={t('cliRoutePlaceholder')}
          aria-label={t('cliRoute')}
          disabled={disabled || preset !== 'custom'}
          onChange={(event) => { setRoute(event.target.value) }}
        />
      </div>
      {routeInvalid || routeTaken
        ? <p className={styles['error']}>{t(routeInvalid ? 'cliRouteInvalid' : 'cliRouteTaken')}</p>
        : null}

      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('cliDisplayName')}</span>
        <input
          className={styles['input']}
          type="text"
          value={displayName}
          placeholder={route.length === 0 ? t('cliDisplayName') : route}
          aria-label={t('cliDisplayName')}
          disabled={disabled}
          onChange={(event) => { setDisplayName(event.target.value) }}
        />
      </div>

      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('cliCommand')}</span>
        <input
          className={styles['input']}
          type="text"
          value={command}
          placeholder={t('cliCommandPlaceholder')}
          aria-label={t('cliCommand')}
          disabled={disabled}
          onChange={(event) => { setCommand(event.target.value) }}
        />
      </div>
      {command.length > 0 && commandMissing
        ? <p className={styles['error']}>{t('cliCommandRequired')}</p>
        : null}

      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('cliArgs')}</span>
        <input
          className={styles['input']}
          type="text"
          value={args}
          placeholder={t('cliArgsPlaceholder')}
          aria-label={t('cliArgs')}
          disabled={disabled}
          onChange={(event) => { setArgs(event.target.value) }}
        />
      </div>
      <p className={styles['advancedHint']}>{t('cliArgsHint')}</p>

      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      {hint === undefined ? null : <p className={styles['advancedHint']}>{hint}</p>}

      <EditorFooter
        t={t}
        busy={busy}
        submitDisabled={disabled || !ready}
        submitLabelKey="create"
        submitBusyLabelKey="creating"
        onCancel={() => { props.onClose(false) }}
        onSubmit={() => { void create() }}
      />
    </div>
  )
}
