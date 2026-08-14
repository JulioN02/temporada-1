import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createParser, csvInfo, csvToJson, formatCsv } from '../src/core/csv.ts'
import { CsvError } from '../src/core/errors.ts'
import { runCli } from './helpers/exec.ts'
import { cleanup, makeTempDir, writeTempFile } from './helpers/temp.ts'

/** Collect every record of the streaming parser. */
async function collect(source: AsyncIterable<Buffer | string>): Promise<string[][]> {
  const out: string[][] = []
  for await (const record of createParser(source)) out.push(record)
  return out
}

async function collectJson(source: AsyncIterable<Buffer | string>): Promise<string> {
  let out = ''
  for await (const chunk of csvToJson(source)) out += chunk
  return out
}

describe('core/csv state machine (createParser)', () => {
  it('basic 3-record file, rows + trailing newline', async () => {
    assert.deepEqual(await collect(['a,b\n1,2\n3,4\n']), [
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('chunk boundaries do not change records (string AND Buffer chunks)', async () => {
    assert.deepEqual(await collect([Buffer.from('a,'), 'b\n1,', Buffer.from('2\n')]), [
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('CRLF normalized to LF; CRLF split across chunks', async () => {
    assert.deepEqual(await collect(['a,b\r\n1,2\r\n']), [
      ['a', 'b'],
      ['1', '2'],
    ])
    assert.deepEqual(await collect(['a,b\r', '\n1,2\r\n']), [
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('lone \\r (classic Mac) also ends a record; trailing \\r at EOF counts', async () => {
    assert.deepEqual(await collect(['a,b\r1,2\r']), [
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('quoted fields: commas, "" escapes and embedded newlines', async () => {
    assert.deepEqual(await collect(['a,b,c\n1,"x,y","he said ""hi"""\n']), [
      ['a', 'b', 'c'],
      ['1', 'x,y', 'he said "hi"'],
    ])
    assert.deepEqual(await collect(['1,"x\ny",3\n']), [['1', 'x\ny', '3']])
  })

  it('quoted CRLF/CR inside quotes normalize to LF (single newline)', async () => {
    assert.deepEqual(await collect(['1,"x\r\ny",3\n']), [['1', 'x\ny', '3']])
    assert.deepEqual(await collect(['1,"x\ry",3\n']), [['1', 'x\ny', '3']])
  })

  it('empty quoted field "": is a real record, not a skipped line', async () => {
    assert.deepEqual(await collect(['a,""\r\n']), [['a', '']])
    assert.deepEqual(await collect(['""\n']), [['']])
  })

  it('BOM stripped on the first chunk', async () => {
    assert.deepEqual(await collect(['\uFEFFa,b\n1,2\n']), [
      ['a', 'b'],
      ['1', '2'],
    ])
    // BOM split across chunks still stripped
    assert.deepEqual(await collect([Buffer.from([0xef]), Buffer.from([0xbb, 0xbf]), 'a,b\n']), [['a', 'b']])
  })

  it('bare empty lines are SKIPPED (leading, middle, trailing, lone \\r\\n)', async () => {
    assert.deepEqual(await collect(['\n\na,b\n\n1,2\r\n\r\n']), [
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('trailing comma means a final empty field; empty-quoted line counts', async () => {
    assert.deepEqual(await collect(['a,b,\n']), [['a', 'b', '']])
  })

  it('final line without trailing newline counts as a record', async () => {
    assert.deepEqual(await collect(['a,b\n1,2']), [
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('empty input -> no records', async () => {
    assert.deepEqual(await collect([]), [])
  })

  it('lenient mid-field quote ENTERS quoted mode; closing quote at EOF ends the field', async () => {
    assert.deepEqual(await collect(['ab"cd"\n']), [['abcd']])
    assert.deepEqual(await collect(['1,"x"']), [['1', 'x']]) // EOF right after closing quote is fine
  })

  it('STRICT: any character after a closing quote is a stray -> CsvError', async () => {
    await assert.rejects(
      collect(['a"b"c\n']),
      (err: unknown) => {
        assert.ok(err instanceof CsvError)
        assert.match((err as Error).message, /after closing quote/)
        return true
      },
    )
  })

  it('multibyte UTF-8 split across chunk boundaries decodes cleanly (StringDecoder)', async () => {
    assert.deepEqual(await collect([Buffer.from([0xc3]), Buffer.from([0xb1, 0x2c]), 'a\n']), [
      ['ñ', 'a'],
    ])
  })

  it('unterminated quoted field at EOF -> CsvError naming row 2', async () => {
    await assert.rejects(
      collect(['a,b\n1,"unterminated']),
      (err: unknown) => {
        assert.ok(err instanceof CsvError)
        assert.match((err as Error).message, /unterminated quoted field at row 2/)
        return true
      },
    )
  })

  it('stray character after closing quote -> CsvError with row', async () => {
    await assert.rejects(
      collect(['a,"b"xc\n']),
      (err: unknown) => {
        assert.ok(err instanceof CsvError)
        assert.match((err as Error).message, /after closing quote at row 1/)
        return true
      },
    )
  })
})

describe('core/csv adapters', () => {
  it('csvInfo: data rows exclude the header; header-only -> 0 rows', async () => {
    assert.deepEqual(await csvInfo(['a,b\n1,2\n3,4\n']), { rows: 2, columns: 2 })
    assert.deepEqual(await csvInfo(['a,b\n']), { rows: 0, columns: 2 })
  })

  it('csvInfo: empty / blank-only input -> rows 0, columns 0', async () => {
    assert.deepEqual(await csvInfo([]), { rows: 0, columns: 0 })
    assert.deepEqual(await csvInfo(['\n\n']), { rows: 0, columns: 0 })
  })

  it('csvInfo: BOM and CRLF inputs are counted normally', async () => {
    assert.deepEqual(await csvInfo(['\uFEFFa,b\r\n1,2\r\n']), { rows: 1, columns: 2 })
  })

  it('formatCsv: strips BOM, normalizes CRLF, re-quotes embedded newlines', async () => {
    let out = ''
    for await (const line of formatCsv(['\uFEFFa,b\r\n1,"x\ny"\r\n'])) out += line
    assert.equal(out, 'a,b\n1,"x\ny"\n')
  })

  it('formatCsv: quotes only fields needing it (comma/quote/newline); "" doubled', async () => {
    let out = ''
    for await (const line of formatCsv(['a,b,c\nplain,"x,y","he said ""hi"""\n'])) out += line
    assert.equal(out, 'a,b,c\nplain,"x,y","he said ""hi"""\n')
  })

  it('csvToJson: quoting example -> exactly the expected JSON array', async () => {
    const out = await collectJson(['a,b,c\n1,"x,y","he said ""hi"""\n'])
    assert.equal(out, '[{"a":"1","b":"x,y","c":"he said \\"hi\\""}]')
    assert.deepEqual(JSON.parse(out), [{ a: '1', b: 'x,y', c: 'he said "hi"' }])
  })

  it('csvToJson: empty and header-only input -> []', async () => {
    assert.equal(await collectJson([]), '[]')
    assert.equal(await collectJson(['a,b\n']), '[]')
  })

  it('csvToJson: ragged rows (extra field ignored, missing field "")', async () => {
    const out = await collectJson(['a,b\n1,2,3\n4\n'])
    assert.deepEqual(JSON.parse(out), [
      { a: '1', b: '2' },
      { a: '4', b: '' },
    ])
  })
})

describe('csv CLI', () => {
  it('info: prints rows/columns exactly, exit 0', () => {
    const r = runCli(['csv', 'info'], { input: 'a,b\n1,2\n3,4\n' })
    assert.equal(r.status, 0)
    assert.equal(r.stderr, '')
    assert.equal(r.stdout, 'rows: 2\ncolumns: 2\n')
  })

  it('info: header-only -> rows: 0; empty input -> rows: 0, columns: 0', () => {
    const headerOnly = runCli(['csv', 'info'], { input: 'a,b\n' })
    assert.equal(headerOnly.status, 0)
    assert.equal(headerOnly.stdout, 'rows: 0\ncolumns: 2\n')
    const empty = runCli(['csv', 'info'], { input: '' })
    assert.equal(empty.status, 0)
    assert.equal(empty.stdout, 'rows: 0\ncolumns: 0\n')
  })

  it('info: reads from a file argument and via -i', async () => {
    const dir = await makeTempDir()
    try {
      const f = await writeTempFile(dir, 'data.csv', 'a,b\n1,2\n')
      const viaPos = runCli(['csv', 'info', f])
      assert.equal(viaPos.status, 0)
      assert.equal(viaPos.stdout, 'rows: 1\ncolumns: 2\n')
      const viaFlag = runCli(['csv', 'info', '-i', f])
      assert.equal(viaFlag.status, 0)
      assert.equal(viaFlag.stdout, 'rows: 1\ncolumns: 2\n')
    } finally {
      await cleanup(dir)
    }
  })

  it('format: BOM stripped, only \\n line endings, embedded newline preserved', () => {
    const r = runCli(['csv', 'format'], { input: '\uFEFFa,b\r\n1,"x\ny"\r\n' })
    assert.equal(r.status, 0)
    assert.equal(r.stderr, '')
    assert.ok(r.stdout.startsWith('a,b'), 'BOM must be stripped')
    assert.ok(!r.stdout.includes('\r'), 'CRLF must be normalized')
    assert.equal(r.stdout, 'a,b\n1,"x\ny"\n')
  })

  it('tojson: quoting incl. "" escape', () => {
    const r = runCli(['csv', 'tojson'], { input: 'a,b,c\n1,"x,y","he said ""hi"""\n' })
    assert.equal(r.status, 0)
    assert.equal(r.stderr, '')
    assert.deepEqual(JSON.parse(r.stdout), [{ a: '1', b: 'x,y', c: 'he said "hi"' }])
  })

  it('tojson: unterminated quote -> exit 2, stdout EMPTY, stderr names row 2', () => {
    const r = runCli(['csv', 'tojson'], { input: 'a,b\n1,"unterminated' })
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /row 2/)
    assert.doesNotMatch(r.stderr, /^\s+at /m, 'no stack frames')
  })

  it('info: unterminated quote -> exit 2, stdout empty, stderr names row', () => {
    const r = runCli(['csv', 'info'], { input: 'a,b\n1,"unterminated' })
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /row 2/)
  })

  it('tojson: 100k-row ~18 MB file -> exactly 100000 objects, exit 0', async () => {
    const dir = await makeTempDir()
    try {
      const rows: string[] = ['id,name,value']
      for (let i = 1; i <= 100000; i++) rows.push(`${i},${'v'.repeat(160)},${i * 2}`)
      const csv = rows.join('\n') + '\n'
      assert.ok(csv.length > 15 * 1024 * 1024, `expected ~18MB fixture, got ${csv.length}`)
      const f = await writeTempFile(dir, 'big.csv', csv)
      const r = runCli(['csv', 'tojson', f], { maxBuffer: 256 * 1024 * 1024 })
      assert.equal(r.status, 0)
      const parsed = JSON.parse(r.stdout) as Array<{ id: string; name: string; value: string }>
      assert.equal(parsed.length, 100000)
      assert.equal(parsed[0]!.id, '1')
      assert.equal(parsed[99999]!.id, '100000')
      assert.ok(parsed[50000]!.name.length === 160)
    } finally {
      await cleanup(dir)
    }
  })

  it('tojson: 10 MB single wide row (streaming path), one object', async () => {
    const wide = `a,b,c\n"${'x'.repeat(10 * 1024 * 1024)}",b,c\n`
    const r = runCli(['csv', 'tojson'], { input: wide, maxBuffer: 256 * 1024 * 1024 })
    assert.equal(r.status, 0)
    const parsed = JSON.parse(r.stdout) as Array<{ a: string; b: string; c: string }>
    assert.equal(parsed.length, 1)
    assert.equal(parsed[0]!.a.length, 10 * 1024 * 1024)
    assert.equal(parsed[0]!.b, 'b')
  })

  it('missing file -> exit 2, stdout empty, stderr names the path', async () => {
    const dir = await makeTempDir()
    try {
      const r = runCli(['csv', 'info', `${dir}/nope.csv`])
      assert.equal(r.status, 2)
      assert.equal(r.stdout, '')
      assert.match(r.stderr, /nope\.csv/)
    } finally {
      await cleanup(dir)
    }
  })

  it('unknown action -> usage error exit 1', () => {
    const r = runCli(['csv', 'frobnicate'], { input: 'a,b\n' })
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /csv/)
  })
})