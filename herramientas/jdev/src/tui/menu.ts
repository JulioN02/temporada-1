import { select } from '@inquirer/prompts'
import { styleText } from 'node:util'

export interface MenuChoice<T> {
  name: string
  value: T
  description?: string
  disabled?: boolean | string
}

export interface MenuThemeConfig {
  keybindings?: readonly ('vim' | 'emacs')[]
  style?: {
    keysHelpTip?: (keys: ReadonlyArray<readonly [string, string]>) => string
  }
}

export interface MenuConfig<T> {
  message: string
  choices: readonly MenuChoice<T>[]
  pageSize?: number
  /** Value of the choice initially highlighted. */
  default?: T
  /** Optional theme overrides merged over the j/k-aware defaults. */
  theme?: MenuThemeConfig
}

/**
 * TUI menu prompt: arrows AND vim-style navigation (j down / k up).
 *
 * @inquirer/select supports this natively through `theme.keybindings:
 * ['vim']` — `isUpKey`/`isDownKey` then accept k/j in addition to the arrow
 * keys, which always remain active. Enabling vim also disables the built-in
 * search-as-you-type (typing letters no longer jumps around), which is what
 * we want for a menu.
 *
 * The default help line only advertises the arrow keys, so we override
 * `keysHelpTip` to tell the user about j/k as well.
 */
const menuTheme: MenuThemeConfig = {
  keybindings: ['vim'],
  style: {
    keysHelpTip: (): string => [
      `${styleText('bold', '↑↓')}${styleText('bold', '/')}${styleText('bold', 'jk')} ${styleText('dim', 'navigate')}`,
      `${styleText('bold', '⏎')} ${styleText('dim', 'select')}`,
    ].join(styleText('dim', ' • ')),
  },
}

export async function menuSelect<const T>(config: MenuConfig<T>): Promise<T> {
  const theme: MenuThemeConfig = config.theme === undefined
    ? menuTheme
    : {
        ...menuTheme,
        ...config.theme,
        style: { ...menuTheme.style, ...config.theme.style },
      }
  return select<T>({ ...config, theme })
}