#!/usr/bin/env node
import { Client } from 'pg'
import cac from 'cac'
import path from 'node:path'
import fs from 'fs-extra'

import camelCase from 'camelcase'

// Cross platform clear console.
process.stdout.write(
    process.platform === 'win32' ? '\x1B[2J\x1B[0f' : '\x1B[2J\x1B[3J\x1B[H',
)

const cli = cac('postgres-typebox')

cli.command('', 'Generate Typebox interfaces from Postgres database')
    .option('--uri <uri>', 'Postgres URI')
    .option('--output <output>', 'Output directory')
    .option('--camelCase', 'Use camelCase', { default: false })
    .option('--table <table>', 'Only this table, can be passed multiple times')

    .action(async (config) => {
        const isCamelCase = config.camelCase
        const isNullish = config.nullish && config.nullish === true
        const isRequiredString =
            config.requiredString && config.requiredString === true
        function nullable(type: string) {
            if (isNullish)
                return `Type.Optional(Type.Union([${type}, Type.Null()]))`
            else return `Type.Union([${type}, Type.Null()])`
        }

        function getType(descType: Desc['Type'], descNull: Desc['Null']) {
            const type = descType.split('(')[0].split(' ')[0]
            const isNull = descNull === 'YES'
            switch (type) {
                case 'date':
                case 'datetime':
                case 'timestamp':
                case 'time':
                case 'year':
                case 'char':
                case 'varchar':
                case 'tinytext':
                case 'text':
                case 'mediumtext':
                case 'longtext':
                case 'json':
                case 'decimal':
                    if (isNull) return nullable('Type.String()')
                    else if (isRequiredString)
                        return 'Type.String({ minLength: 1 })'
                    else return 'Type.String()'
                case 'tinyint':
                case 'smallint':
                case 'mediumint':
                case 'int':
                case 'bigint':
                case 'float':
                case 'double':
                    const unsigned = descType.endsWith(' unsigned')
                    const numberType = unsigned
                        ? 'Type.Number({ minimum: 0 })'
                        : 'Type.Number()'
                    if (isNull) return nullable(numberType)
                    else return numberType
                case 'enum':
                    const value = descType
                        .replace('enum(', '')
                        .replace(')', '')
                        .replaceAll(',', ', ')
                    return `Type.Unsafe<${value.replaceAll(', ', ' | ')}>({ type: 'string', enum: [${value}] })`
            }
        }

        const db = new Client(config.uri)
        const t = await db.query(
            'SELECT table_name as table_name FROM information_schema.tables WHERE table_schema = ?',
            ['public'],
        )
        let tables = t.rows[0]
            .map((row: any) => row.table_name)
            .filter((table: string) => !table.startsWith('knex_'))
            .sort() as Tables

        const onlyTables =
            typeof config.table === 'string' ? [config.table] : config.table
        if (onlyTables && onlyTables.length)
            tables = tables.filter((table) => onlyTables.includes(table))

        if (config.ignore && config.ignore.length)
            tables = tables.filter((table) => !config.ignore.includes(table))

        for (let table of tables) {
            const d = await db.query(`DESC ${table}`)
            const describes = d.rows[0] as Desc[]
            if (isCamelCase) table = camelCase(table)
            let content = `import { Type } from '@sinclair/typebox'
  import type { Static } from '@sinclair/typebox'

  export const ${table} = Type.Object({`
            for (const desc of describes) {
                const field = isCamelCase ? camelCase(desc.Field) : desc.Field
                const type = getType(desc.Type, desc.Null)
                content = `${content}
    ${field}: ${type},`
            }
            content = `${content}
  })

  export type ${camelCase(`${table}Type`)} = Static<typeof ${table}>
  `
            const dir =
                config.output && config.output !== '' ? config.output : '.'
            const file =
                config.suffix && config.suffix !== ''
                    ? `${table}.${config.suffix}.ts`
                    : `${table}.ts`
            const dest = path.join(dir, file)
            console.log('Created:', dest)
            fs.outputFileSync(dest, content)
        }
        await db.end()
    })

type Tables = string[]
interface Desc {
    Field: string
    Type: string
    Null: 'YES' | 'NO'
}

cli.help().parse(process.argv)
