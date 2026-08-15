import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runCli } from './helpers/exec.ts'
import { splitArgs } from '../src/tui/index.ts'
import { resolveLang, setLang, t, getLang } from '../src/i18n.ts'

describe('tui i18n contract', () => {
  it('Spanish is neutral: no voseo in any UI string', () => {
    setLang('es')
    for (const key of ['mainMenu', 'titleTail', 'mUuid', 'mJson', 'backToMain', 'backPrompt', 'mHttp'] as const) {
      const s = t(key)
      assert.ok(!s.includes('querés'), `${key} must not use voseo: ${s}`)
      assert.ok(!s.includes('podés'), `${key} must not use voseo: ${s}`)
    }
    assert.equal(t('mainMenu'), 'Selecciona una opción')
  })

  it('JDEV_LANG=en selects English', () => {
    process.env.JDEV_LANG = 'en'
    setLang(resolveLang(undefined))
    assert.equal(t('mainMenu'), 'Select an option')
    delete process.env.JDEV_LANG
    setLang('es')
  })

  it('--lang flag overrides the JDEV_LANG env var', () => {
    process.env.JDEV_LANG = 'en'
    assert.equal(resolveLang('es'), 'es')
    setLang(resolveLang('es'))
    assert.equal(t('mainMenu'), 'Selecciona una opción')
    delete process.env.JDEV_LANG
    setLang('es')
  })

  it('template variables are interpolated', () => {
    setLang('es')
    assert.equal(t('moreLines', { n: 7 }), '… 7 líneas más')
  })
})

describe('tui module contract', () => {
  it('help lists the tui subcommand among the 10 subcommands', () => {
    const r = runCli([])
    assert.equal(r.status, 0)
    assert.ok(r.stdout.includes('tui'), 'help must list subcommand \'tui\'')
    assert.ok(r.stdout.includes('interactive TUI menu'), 'help must describe the tui subcommand')
  })

  it('tui on a non-TTY stdin/stdout exits 1 with a usage error naming TTY', () => {
    // The test harness pipes stdin (spawnSync input), so process.stdin is not a TTY.
    const r = runCli(['tui'])
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /requires an interactive terminal|TTY/i)
  })

  it('tui on a non-TTY never leaks the interactive menu to stdout (pipe discipline)', () => {
    const r = runCli(['tui'])
    assert.equal(r.stdout, '', 'interactive frames must never reach piped stdout')
    assert.doesNotMatch(r.stderr, /\x1b\[[0-9;]*m/, 'no ANSI escapes in diagnostics when piped')
  })
})

describe('tui splitArgs (free-mode tokenizer)', () => {
  it('splits on whitespace', () => {
    assert.deepEqual(splitArgs('uuid --v7 --count 3'), ['uuid', '--v7', '--count', '3'])
  })

  it('keeps double-quoted segments as a single token', () => {
    assert.deepEqual(splitArgs('json validate "a b.json"'), ['json', 'validate', 'a b.json'])
  })

  it('keeps single-quoted segments as a single token', () => {
    assert.deepEqual(splitArgs("csv tojson 'a,b,c'"), ['csv', 'tojson', 'a,b,c'])
  })

  it('empty and whitespace-only input yields no tokens', () => {
    assert.deepEqual(splitArgs(''), [])
    assert.deepEqual(splitArgs('   '), [])
  })
})